// Person 3: shared Gemini client + callJson helper. Server-only.
//
// Free tier = 5 requests/min PER MODEL, so we rotate across several models with an in-memory
// rate limiter: best model first, skip any model that is at its limit or cooling down after a
// 429/503, and wait briefly only if every model is busy.
import 'server-only';
import { ApiError, GoogleGenAI, type Part } from '@google/genai';
import { z } from 'zod';

/** Best first. GEMINI_MODEL in .env.local jumps to the front. */
export const MODELS = [...new Set([
  process.env.GEMINI_MODEL,
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
].filter(Boolean) as string[])];
export const MODEL = MODELS[0];

const RPM = Number(process.env.GEMINI_RPM_PER_MODEL) || 5;   // raise when on a paid key
const MAX_WAIT_MS = Number(process.env.AI_MAX_WAIT_MS) || 12_000; // how long a request may queue

/** Thrown when the model can't produce valid output (or no model is free). Routes catch this and fall back. */
export class AiError extends Error {
  constructor(message: string, readonly task: string, readonly cause?: unknown) {
    super(message);
    this.name = 'AiError';
  }
}

// ---------- rate limiter ----------

const recent = new Map<string, number[]>();   // model → timestamps of calls in the last minute
const coolUntil = new Map<string, number>();  // model → don't use before this time
const dead = new Set<string>();               // models that 404 for this key

function nextFreeAt(model: string, now: number): number {
  const calls = (recent.get(model) ?? []).filter((t) => now - t < 60_000);
  recent.set(model, calls);
  const rateFree = calls.length < RPM ? now : calls[0] + 60_000;
  return Math.max(rateFree, coolUntil.get(model) ?? 0);
}

/** Pick the best model that is free now, or wait (up to MAX_WAIT_MS) for the soonest one. */
async function acquire(task: string, deadline: number): Promise<string> {
  for (;;) {
    const now = Date.now();
    let soonest = Infinity;
    for (const m of MODELS) {
      if (dead.has(m)) continue;
      const at = nextFreeAt(m, now);
      if (at <= now) {
        recent.get(m)!.push(now);
        return m;
      }
      soonest = Math.min(soonest, at);
    }
    if (soonest === Infinity || soonest > deadline) {
      throw new AiError(`AI task "${task}" failed: all Gemini models are busy (free-tier limit)`, task);
    }
    await new Promise((r) => setTimeout(r, soonest - now + 50));
  }
}

function retryDelayMs(err: ApiError): number {
  const m = /retry in ([\d.]+)s/i.exec(err.message) ?? /"retryDelay":"(\d+)s"/.exec(err.message);
  return m ? Math.ceil(Number(m[1]) * 1000) : 60_000;
}

// ---------- client ----------

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (!_client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new AiError('GEMINI_API_KEY is not set', 'client');
    // No SDK retries: the rotation below handles 429/5xx by switching models instead of waiting.
    _client = new GoogleGenAI({ apiKey, httpOptions: { timeout: 25_000, retryOptions: { attempts: 1 } } });
  }
  return _client;
}

/** Provider-neutral content: text, or an image as base64. */
export type AiPart = { text: string } | { image: { base64: string; mediaType: string } };

function toParts(content: AiPart[] | string): Part[] {
  if (typeof content === 'string') return [{ text: content }];
  return content.map((p) =>
    'text' in p ? { text: p.text } : { inlineData: { mimeType: p.image.mediaType, data: p.image.base64 } },
  );
}

/** zod → plain JSON Schema for Gemini's responseJsonSchema. */
function jsonSchema(schema: z.ZodType): unknown {
  const s = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

/**
 * Ask Gemini for JSON matching `schema`. JSON mode + response schema, validated with zod.
 * Bad/invalid output → retry once. Rate limit / overload → cool that model down and try another.
 * Throws AiError when it can't get valid output.
 */
export async function callJson<S extends z.ZodType>(opts: {
  task: string;
  system: string;
  content: AiPart[] | string;
  schema: S;
  maxTokens?: number;
}): Promise<z.infer<S>> {
  const deadline = Date.now() + MAX_WAIT_MS;
  const parts = toParts(opts.content);
  const schema = jsonSchema(opts.schema);
  let lastErr: unknown;
  let badOutputs = 0;

  for (let tries = 0; tries < MODELS.length + 2 && badOutputs < 2; tries++) {
    const model = await acquire(opts.task, deadline);
    try {
      const res = await client().models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: opts.system,
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          maxOutputTokens: opts.maxTokens ?? 4000,
          temperature: 0.2,
        },
      });

      if (res.promptFeedback?.blockReason) throw new Error(`prompt blocked: ${res.promptFeedback.blockReason}`);
      const finish = res.candidates?.[0]?.finishReason;
      if (finish && finish !== 'STOP') throw new Error(`generation stopped: ${finish}`);

      const text = res.text;
      if (!text) throw new Error('empty response');
      const parsed = opts.schema.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error(`schema validation failed: ${parsed.error.message}`);
      return parsed.data;
    } catch (err) {
      lastErr = err;
      if (err instanceof AiError) throw err;
      if (err instanceof ApiError) {
        if (err.status === 429) { coolUntil.set(model, Date.now() + retryDelayMs(err)); continue; }
        if ([500, 503, 504].includes(err.status)) { coolUntil.set(model, Date.now() + 30_000); continue; }
        if (err.status === 404) { dead.add(model); continue; }
        if ([400, 401, 403].includes(err.status)) break; // bad key / bad request won't fix itself
      }
      if (err instanceof Error && /timeout|timed out|abort|deadline/i.test(err.message)) {
        coolUntil.set(model, Date.now() + 30_000);
        continue;
      }
      badOutputs++; // invalid JSON / schema mismatch / blocked → one more try
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message.slice(0, 300) : String(lastErr);
  throw new AiError(`AI task "${opts.task}" failed: ${msg}`, opts.task, lastErr);
}

/** Wrap untrusted user text so the prompt can tell the model to treat it as data only. */
export function untrusted(label: string, text: string): string {
  const safe = text.replaceAll('</user_data>', '');
  return `<user_data label="${label}">\n${safe}\n</user_data>`;
}
