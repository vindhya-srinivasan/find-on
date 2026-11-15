// Person 2: desk marks item received; [id] is the item code, e.g. FO-4821. Contract: Team Tasks > API routes.
import { ItemCodeParam, error, json } from '@/lib/api';
import { publicItemOf } from '@/lib/db';
import { requireUser } from '@/lib/supabase/auth';
import { supabaseAdmin } from '@/lib/supabase/server';
import type { FoundItemRow } from '@/types';

const FAIL = () => error('Something went wrong. Try again.', 500);
const NOT_FOUND = () => error('Item not found', 404);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser(req, { write: true });
    if (me instanceof Response) return me;
    if (me.role !== 'desk') return error('Desk staff only.', 403);

    const code = (await ctx.params).id.toUpperCase();
    if (!ItemCodeParam.safeParse({ id: code }).success) return NOT_FOUND();
    const db = supabaseAdmin();
    const r = await db.from('found_items').select('*').eq('item_code', code).maybeSingle();
    if (r.error) return FAIL();
    if (!r.data) return NOT_FOUND();
    const item = r.data as FoundItemRow;

    const u = await db
      .from('found_items')
      .update({ status: 'at_desk', held_at_desk_id: me.desk_id ?? item.held_at_desk_id })
      .eq('id', item.id)
      .eq('status', 'en_route_to_desk')
      .select();
    if (u.error) return FAIL();
    if (!u.data?.length) return error('This item is not on its way to a desk.', 409);

    return json({ item: await publicItemOf(u.data[0] as FoundItemRow) });
  } catch {
    return FAIL();
  }
}
