// Person 2: enter pickup code -> returned. Contract: Team Tasks > API routes.
import { IdParam, ReturnBody, badRequest, error, json } from '@/lib/api';
import { OPEN_CLAIM, PASSED_CLAIM, handlerRole, notify } from '@/lib/db';
import { requireUser } from '@/lib/supabase/auth';
import { supabaseAdmin } from '@/lib/supabase/server';
import type { FoundItemRow } from '@/types';

const FAIL = () => error('Something went wrong. Try again.', 500);
const NOT_FOUND = () => error('Item not found', 404);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser(req, { write: true });
    if (me instanceof Response) return me;

    const { id } = await ctx.params;
    if (!IdParam.safeParse({ id }).success) return NOT_FOUND();
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return error('Invalid JSON', 400);
    }
    const body = ReturnBody.safeParse(raw);
    if (!body.success) return badRequest(body.error);

    const db = supabaseAdmin();
    const r = await db.from('found_items').select('*').eq('id', id).maybeSingle();
    if (r.error) return FAIL();
    if (!r.data) return NOT_FOUND();
    const item = r.data as FoundItemRow;
    const role = handlerRole(me, item);
    if (!role) return NOT_FOUND();
    const expected = role === 'desk' ? 'at_desk' : 'with_finder';
    if (item.status !== expected) return error('This item cannot be returned right now.', 409);

    const c = await db
      .from('claims')
      .select('id, status, claimant_id, lost_report_id')
      .eq('found_item_id', item.id)
      .in('status', PASSED_CLAIM)
      .eq('pickup_code', body.data.pickupCode)
      .maybeSingle();
    if (c.error) return FAIL();
    if (!c.data) return error("That code doesn't match.", 400);
    const claim = c.data;
    if (claim.claimant_id === me.id) return error("You can't release your own claim.", 403); // the releaser must be a different human

    // Exactly-once gate: only one request flips the item to returned (no 0002 function, approved decision 5).
    const u = await db.from('found_items').update({ status: 'returned' }).eq('id', item.id).eq('status', expected).select('id');
    if (u.error) return FAIL();
    if (!u.data?.length) return error('This item cannot be returned right now.', 409);

    const w = await db.from('claims').update({ status: 'returned' }).eq('id', claim.id); // item gate above already won; a racing two-pass demotion must not strand the claim
    if (w.error) return FAIL();
    const o = await db
      .from('claims')
      .update({ status: 'rejected', pickup_code: null })
      .eq('found_item_id', item.id)
      .neq('id', claim.id)
      .in('status', OPEN_CLAIM);
    if (o.error) return FAIL();
    const l = await db.from('lost_reports').update({ status: 'resolved' }).eq('id', claim.lost_report_id).eq('status', 'open');
    if (l.error) return FAIL();

    await notify([claim.claimant_id], `Your ${item.public_title} was returned.`, `/claims/${claim.id}`);
    return json({ status: 'returned' });
  } catch {
    return FAIL();
  }
}
