// Person 2: small helpers shared by API routes.
import { z } from 'zod';
import type { PhotoAnalysis, ReturnMethod } from '@/types';

export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}
export function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
/** Placeholder for routes not built yet. Person 1 uses lib/mock.ts until a route stops returning this. */
export function notImplemented(route: string) {
  return Response.json({ error: `${route} not implemented yet` }, { status: 501 });
}

// ---- Request validation (trust boundary). Routes: Schema.safeParse(...) then badRequest(r.error) on failure. ----
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const ITEM_CODE_RE = /^FO-[0-9]{4}$/;

/** First issue as "<path>: <message>", status 400. Never echoes input values. */
export function badRequest(err: z.ZodError): Response {
  const issue = err.issues[0];
  const path = issue?.path.map(String).join('.');
  const message = issue?.message ?? 'Invalid request';
  return error(path ? `${path}: ${message}` : message, 400);
}

/** FormData to a plain object; keeps every `photos` entry (Object.fromEntries would keep only the last). */
export function formFields(fd: FormData): Record<string, unknown> {
  return { ...Object.fromEntries(fd), photos: fd.getAll('photos') };
}

export const IdParam = z.object({ id: z.guid() });
/** /api/items/[id]/receive: the segment is the item code (FO-1234), not the UUID. */
export const ItemCodeParam = z.object({ id: z.string().regex(ITEM_CODE_RE) });

const BuildingId = z.string().min(1).max(64);
const Landmark = z.string().trim().max(120);

export const PhotoAnalysisSchema: z.ZodType<PhotoAnalysis> = z.object({
  is_valid_item: z.boolean(),
  reject_reason: z.string().max(300).nullable(),
  category: z.string().trim().min(1).max(60),
  color: z.string().trim().min(1).max(60),
  brand: z.string().trim().max(60).nullable(),
  public_title: z.string().trim().min(1).max(120),
  hidden_details: z.array(z.object({ detail: z.string().min(1).max(300), weight: z.literal([1, 2, 3]) })).max(20),
  verifiability: z.enum(['high', 'medium', 'low'] as const satisfies readonly PhotoAnalysis['verifiability'][]),
  is_valuable: z.boolean(),
});

export const FoundAnalyzeForm = z.object({
  photos: z.array(z.file().max(MAX_PHOTO_BYTES).mime(PHOTO_MIME)).min(1).max(3),
  buildingId: BuildingId,
  landmark: Landmark.optional(),
});

export const FoundForm = FoundAnalyzeForm.extend({
  foundAt: z.iso.datetime({ offset: true }),
  analysis: z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.issues.push({ code: 'custom', message: 'analysis must be valid JSON', input: s });
        return z.NEVER;
      }
    })
    .pipe(PhotoAnalysisSchema),
  returnMethod: z.enum(['desk', 'finder'] as const satisfies readonly ReturnMethod[]),
  availability: z.string().trim().max(200).optional(),
});

/** Form field holding a JSON array string, e.g. '["LVL"]'. Bad JSON is a zod issue, never a throw. */
const jsonArray = <T extends z.ZodType>(item: T) =>
  z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.issues.push({ code: 'custom', message: 'must be valid JSON', input: s });
        return z.NEVER;
      }
    })
    .pipe(z.array(item).max(10));

/** Lost report form-data. Route: LostForm.safeParse(formFields(fd)); the extra `photos: []` from formFields is stripped. */
export const LostForm = z
  .object({
    text: z.string().trim().min(3).max(2000),
    buildingIds: jsonArray(BuildingId),
    notSure: z.enum(['true', 'false']).transform((v) => v === 'true'),
    landmarks: jsonArray(Landmark),
    photo: z.file().max(MAX_PHOTO_BYTES).mime(PHOTO_MIME).optional(),
  })
  .refine((b) => b.buildingIds.length > 0 || b.notSure, {
    message: 'Pick a building or mark not sure',
    path: ['buildingIds'],
  });

export const ClaimBody = z.object({ foundItemId: z.guid(), lostReportId: z.guid() });

export const AnswersBody = z.object({
  answers: z
    .array(z.object({ question_id: z.string().min(1).max(40), answer: z.string().trim().min(1).max(1000) }))
    .min(1)
    .max(3),
});

export const ReviewBody = z.object({ decision: z.enum(['approve', 'reject']) });
export const ReturnBody = z.object({ pickupCode: z.string().regex(/^[0-9]{6}$/) });
export const ReturnMethodBody = z.object({ returnMethod: z.literal('desk') });
export const MessageBody = z.object({ body: z.string().trim().min(1).max(1000) });
