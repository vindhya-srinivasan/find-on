// Person 2: claim status, item, pickup code (claimant only). Contract: Team Tasks > API routes.
import { connection } from 'next/server';
import { IdParam, error, json } from '@/lib/api';
import { buildClaimDetail, handlerRole, type ClaimRow } from '@/lib/db';
import { requireUser } from '@/lib/supabase/auth';
import { supabaseAdmin } from '@/lib/supabase/server';
import type { FoundItemRow } from '@/types';

const FAIL = () => error('Something went wrong. Try again.', 500);
const NOT_FOUND = () => error('Claim not found', 404);

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const me = await requireUser(req);
    if (me instanceof Response) return me;

    const { id } = await ctx.params;
    if (!IdParam.safeParse({ id }).success) return NOT_FOUND();
    const db = supabaseAdmin();
    const c = await db.from('claims').select('*').eq('id', id).maybeSingle();
    if (c.error) return FAIL();
    const claim = c.data as ClaimRow | null;
    if (!claim) return NOT_FOUND();
    const i = await db.from('found_items').select('*').eq('id', claim.found_item_id).maybeSingle();
    if (i.error) return FAIL();
    const item = i.data as FoundItemRow | null;
    if (!item) return NOT_FOUND();

    // Anyone who isn't the claimant or this item's handler gets a 404, so claim ids can't be probed.
    const viewer = me.id === claim.claimant_id ? 'claimant' : handlerRole(me, item);
    if (!viewer) return NOT_FOUND();
    return json(await buildClaimDetail(me, claim, item, viewer));
  } catch {
    return FAIL();
  }
}
