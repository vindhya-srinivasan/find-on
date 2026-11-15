// Person 3: shared Claude client + callJson helper. Server-only.
// Every AI call in the app goes through callJson, so switching model or provider happens only in this file.
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

/** Spec model. Override with ANTHROPIC_MODEL in .env.local if needed. */
export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

/** Thrown when Claude can't produce valid output after one retry. Routes catch this and fall back. */
export class AiError extends Error {
  constructor(message: string, readonly task: string, readonly cause?: unknown) {
    super(message);
    this.name = 'AiError';
  }
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new AiError('ANTHROPIC_API_KEY is not set', 'client');
    // 30 s per request; the SDK itself retries 429 / 5xx / network errors twice with backoff.
    _client = new Anthropic({ timeout: 30_000, maxRetries: 2 });
  }
  return _client;
}

/** Provider-neutral content: text, or an image as base64. */
export type AiPart = { text: string } | { image: { base64: string; mediaType: string } };

type ImageMedia = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
function toBlocks(content: AiPart[] | string): Anthropic.Beta.BetaContentBlockParam[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content.map((p) =>
    'text' in p
      ? { type: 'text', text: p.text }
      : { type: 'image', source: { type: 'base64', media_type: p.image.mediaType as ImageMedia, data: p.image.base64 } },
  );
}

/** Reasoning effort per task: vision and grading get more thought; parsing, ranking and questions stay fast. */
const EFFORT: Record<string, 'low' | 'medium'> = { analyzePhoto: 'medium', gradeAnswers: 'medium' };

/**
 * Ask Claude for JSON matching `schema` (structured outputs), validate with zod anyway,
 * retry once on bad/invalid output, then throw AiError.
 */
export async function callJson<S extends z.ZodType>(opts: {
  task: string;
  system: string;
  content: AiPart[] | string;
  schema: S;
  maxTokens?: number;
}): Promise<z.infer<S>> {
  const format = zodOutputFormat(opts.schema);
  const blocks = toBlocks(opts.content);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await client().beta.messages.create({
        model: MODEL,
        max_tokens: opts.maxTokens ?? 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default', // if the model declines, the API re-runs the request on a fallback model
        system: opts.system,
        output_config: {
          effort: EFFORT[opts.task] ?? 'low',
          format: { type: 'json_schema', schema: format.schema },
        },
        messages: [{ role: 'user', content: blocks }],
      });

      if (res.stop_reason === 'refusal') throw new Error('model refused');
      if (res.stop_reason === 'max_tokens') throw new Error('output truncated (max_tokens)');

      const text = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const parsed = opts.schema.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error(`schema validation failed: ${parsed.error.message}`);
      return parsed.data;
    } catch (err) {
      lastErr = err;
      if (err instanceof AiError) break; // missing key
      // Bad key or bad request won't fix themselves on retry.
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.BadRequestError) break;
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
