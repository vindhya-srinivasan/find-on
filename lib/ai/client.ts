// Person 3: shared Claude client + callJson helper. Server-only.
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

export const MODEL = 'claude-sonnet-5-5';

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
    // 60 s per request, SDK retries 429/5xx/network twice on its own.
    _client = new Anthropic({ timeout: 60_000, maxRetries: 2 });
  }
  return _client;
}

export type Effort = 'low' | 'medium' | 'high';

/**
 * Ask Claude for JSON matching `schema`. Uses structured outputs so the reply is schema-shaped,
 * validates with zod anyway, retries once on bad/invalid output, then throws AiError.
 */
export async function callJson<S extends z.ZodType>(opts: {
  task: string;
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[] | string;
  schema: S;
  effort?: Effort;
  maxTokens?: number;
}): Promise<z.infer<S>> {
  const format = zodOutputFormat(opts.schema);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await client().beta.messages.create({
        model: MODEL,
        max_tokens: opts.maxTokens ?? 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default', // if Sonnet 5.5 declines, the API retries on a fallback model
        system: opts.system,
        output_config: {
          effort: opts.effort ?? 'low',
          format: { type: 'json_schema', schema: format.schema },
        },
        messages: [{ role: 'user', content: opts.content }],
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
      // Auth / bad-request errors won't fix themselves on retry.
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.BadRequestError) break;
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new AiError(`AI task "${opts.task}" failed: ${msg}`, opts.task, lastErr);
}

/** Wrap untrusted user text so the prompt can tell Claude to treat it as data only. */
export function untrusted(label: string, text: string): string {
  const safe = text.replaceAll('</user_data>', '');
  return `<user_data label="${label}">\n${safe}\n</user_data>`;
}
