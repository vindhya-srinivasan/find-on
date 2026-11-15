// Person 2: claimant uploads a photo as proof instead of answering; the claim goes to a person. Contract: Phase F plan.
import { IdParam, ProofForm, badRequest, error, formFields, json } from '@/lib/api';
import { notify, reviewerIds, type ClaimRow } from '@/lib/db';
import { requireUser } from '@/lib/supabase/auth';
import { supabaseAdmin } from '@/lib/supabase/server';
import { BadImageError, deletePhotos, saveProofPhoto } from '@/lib/supabase/storage';
import type { ClaimStatus, FoundItemRow } from '@/types';

const FAIL = () => error('Something went wrong. Try again.', 500);
const NOT_FOUND = () => error('Claim not found', 404);
const CONFLICT = () => error("Proof can't be added to this claim now.", 409);
const UNAVAILABLE = () => error('Proof upload not available yet', 503);
const OPEN: ClaimStatus[] = ['awaiting_answers', 'needs_review'];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser(req, { write: true });
    if (me instanceof Response) return me;

    const { id } = await ctx.params;
    if (!IdParam.safeParse({ id }).success) return NOT_FOUND();

    const db = supabaseAdmin();
    const c = await db.from('claims').select('*').eq('id', id).maybeSingle();
    if (c.error) return FAIL();
    const claim = c.data as ClaimRow | null;
    if (!claim || claim.claimant_id !== me.id) return NOT_FOUND();
    // Migration 0002 not applied yet: stop before storing anything.
    if (!('proof_photo_path' in claim)) return UNAVAILABLE();
    if (!OPEN.includes(claim.status)) return CONFLICT();

    const it = await db.from('found_items').select('*').eq('id', claim.found_item_id).maybeSingle();
    if (it.error) return FAIL();
    const item = it.data as FoundItemRow | null;
    if (!item) return NOT_FOUND();
    if (item.status === 'returned' || item.status === 'unclaimed') return CONFLICT();

    let fd: FormData;
    try {
      fd = await req.formData();
    } catch {
      return error('Invalid form data', 400);
    }
    const form = ProofForm.safeParse(formFields(fd));
    if (!form.success) return badRequest(form.error);

    let path: string;
    try {
      path = await saveProofPhoto(id, form.data.photo);
    } catch (e) {
      return e instanceof BadImageError ? error('photo: could not read image', 400) : FAIL();
    }

    const hadProof = Boolean(claim.proof_photo_path);
    const u = await db
      .from('claims')
      .update({
        proof_photo_path: path,
        status: 'needs_review',
        ...(claim.status === 'awaiting_answers' && { reason: 'Owner uploaded a photo as proof.' }),
      })
      .eq('id', id)
      .in('status', OPEN)
      .select('id');
    if (u.error || !u.data?.length) {
      // Same path is upserted, so only delete when it isn't an earlier saved proof.
      if (!hadProof) await deletePhotos([path]);
      if (u.error?.code === 'PGRST204' || u.error?.code === '42703') return UNAVAILABLE();
      return u.error ? FAIL() : CONFLICT();
    }

    if (!hadProof) await notify(await reviewerIds(item), `A claim on ${item.public_title} has a proof photo to review.`, `/claims/${id}`);
    return json({ status: 'needs_review' });
  } catch {
    return FAIL();
  }
}
