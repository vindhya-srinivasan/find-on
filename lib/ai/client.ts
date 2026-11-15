// Person 3: shared Gemini client + callJson helper. Server-only.
import 'server-only';
import { ApiError, GoogleGenAI, type Part } from '@google/genai';
import { z } from 'zod';

/**
 * Models tried in order; on overload (429/503/504/timeout) we move to the next one.
 * GEMINI_MODEL in .env.local goes first if set. (3.7/3.8-flash were overloaded on Nov 14; 3.6 answered in ~2 s.)
 */
export const MODELS = [...new Set([process.env.GEMINI_MODEL, 'gemini-3.6-flash', 'gemini-3.5-flash'].filter(Boolean) as string[])];
export const MODEL = MODELS[0];

function isOverload(err: unknown): boolean {
  if (err instanceof ApiError) return [429, 500, 503, 504].includes(err.status);
  return err instanceof Error && /timeout|timed out|abort|deadline/i.test(err.message);
}

/** Thrown when the model can't produce valid output after one retry. Routes catch this and fall back. */
export class AiError extends Error {
  constructor(message: string, readonly task: string, readonly cause?: unknown) {
    super(message);
    this.name = 'AiError';
  }
}

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (!_client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new AiError('GEMINI_API_KEY is not set', 'client');
    // Fail fast (25 s, one SDK retry) so an overloaded model hands off to the next one quickly.
    _client = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: 25_000, retryOptions: { attempts: 2, initialDelay: 1, maxDelay: 4 } },
    });
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
 * Ask Gemini for JSON matching `schema`. Uses JSON mode with a response schema, validates with zod
 * anyway, retries once on bad/invalid output, then throws AiError.
 */
export async function callJson<S extends z.ZodType>(opts: {
  task: string;
  system: string;
  content: AiPart[] | string;
  schema: S;
  maxTokens?: number;
}): Promise<z.infer<S>> {
  let lastErr: unknown;
  let modelIdx = 0;
  let badOutputs = 0;

  // Bad/invalid output → retry once on the same model. Overload → move to the next model.
  while (modelIdx < MODELS.length && badOutputs < 2) {
    const model = MODELS[modelIdx];
    try {
      const res = await client().models.generateContent({
        model,
        contents: [{ role: 'user', parts: toParts(opts.content) }],
        config: {
          systemInstruction: opts.system,
          responseMimeType: 'application/json',
          responseJsonSchema: jsonSchema(opts.schema),
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
      if (err instanceof AiError) break; // missing key
      if (isOverload(err) || (err instanceof ApiError && err.status === 404)) {
        console.warn(`[ai] ${model} unavailable for ${opts.task}, trying next model`);
        modelIdx++;
      } else if (err instanceof ApiError && [400, 401, 403].includes(err.status)) {
        break; // bad key / bad request won't fix itself
      } else {
        badOutputs++;
      }
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new AiError(`AI task "${opts.task}" failed: ${msg}`, opts.task, lastErr);
}

/** Wrap untrusted user text so the prompt can tell the model to treat it as data only. */
export function untrusted(label: string, text: string): string {
  const safe = text.replaceAll('</user_data>', '');
  return `<user_data label="${label}">\n${safe}\n</user_data>`;
}
