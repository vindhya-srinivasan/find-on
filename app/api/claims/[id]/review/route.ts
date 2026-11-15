// Person 2: desk staff or finder approve/reject. Contract: Team Tasks > API routes.
import { IdParam, ReviewBody, badRequest, error, json } from '@/lib/api';
import { PASSED_CLAIM, handlerRole, notify, setClaimPassed, type ClaimRow } from '@/lib/db';
import { requireUser } from '@/lib/supabase/auth';
import { supabaseAdmin } from '@/lib/supabase/server';
import type { FoundItemRow } from '@/types';

const FAIL = () => error('Something went wrong. Try again.', 500);
const NOT_FOUND = () => error('Claim not found', 404);
const NOT_PENDING = () => error('This claim is not waiting for review.', 409);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser(req, { write: true });
    if (me instanceof Response) return me;

    const { id } = await ctx.params;
    if (!IdParam.safeParse({ id }).success) return NOT_FOUND();
    const raw = await req.json().catch(() => undefined);
    if (raw === undefined) return error('Invalid JSON', 400);
    const body = ReviewBody.safeParse(raw);
    if (!body.success) return badRequest(body.error);

    const db = supabaseAdmin();
    const c = await db.from('claims').select('*').eq('id', id).maybeSingle();
    if (c.error) return FAIL();
    const claim = c.data as ClaimRow | null;
    if (!claim) return NOT_FOUND();
    const i = await db.from('found_items').select('*').eq('id', claim.found_item_id).maybeSingle();
    if (i.error) return FAIL();
    const item = i.data as FoundItemRow | null;
    // Only the item's handler reviews, and never their own claim.
    if (!item || !handlerRole(me, item) || claim.claimant_id === me.id) return NOT_FOUND();
    if (claim.status !== 'needs_review') return NOT_PENDING();

    let status: 'approved' | 'rejected';
    if (body.data.decision === 'approve') {
      // shortcut: read-then-write, two approvals at the same instant can both pass; add a DB constraint if that matters
      const o = await db.from('claims').select('id').eq('found_item_id', item.id).neq('id', id).in('status', PASSED_CLAIM).limit(1);
      if (o.error) return FAIL();
      if (o.data?.length) return error('Another claim on this item has already passed.', 409);
      if (!(await setClaimPassed(id, 'needs_review', 'approved'))) return NOT_PENDING();
      status = 'approved';
    } else {
      const u = await db.from('claims').update({ status: 'rejected', pickup_code: null }).eq('id', id).eq('status', 'needs_review').select('id');
      if (u.error) return FAIL();
      if (!u.data?.length) return NOT_PENDING();
      status = 'rejected';
    }

    await notify(
      [claim.claimant_id],
      status === 'approved'
        ? `Your claim for ${item.public_title} was approved. Open it for your pickup code.`
        : `Your claim for ${item.public_title} was not approved.`,
      `/claims/${id}`,
    );
    return json({ status });
  } catch {
    return FAIL();
  }
}
