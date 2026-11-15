// Person 2: finder switches the item to a desk. Contract: Team Tasks > API routes.
import { IdParam, ReturnMethodBody, badRequest, error, json } from '@/lib/api';
import { deskIdFor, publicItemOf } from '@/lib/db';
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
    const body = ReturnMethodBody.safeParse(raw);
    if (!body.success) return badRequest(body.error);

    const db = supabaseAdmin();
    const r = await db.from('found_items').select('finder_id').eq('id', id).maybeSingle();
    if (r.error) return FAIL();
    if (!r.data || r.data.finder_id !== me.id) return NOT_FOUND();

    const desk = await deskIdFor(body.data.deskId);
    if (desk === undefined) return error('deskId: unknown desk', 400);

    const u = await db
      .from('found_items')
      .update({ status: 'en_route_to_desk', return_method: 'desk', held_at_desk_id: desk, finder_availability: null })
      .eq('id', id)
      .eq('status', 'with_finder')
      .select();
    if (u.error) return FAIL();
    if (!u.data?.length) return error('This item is not with the finder.', 409);

    return json({ item: await publicItemOf(u.data[0] as FoundItemRow) });
  } catch {
    return FAIL();
  }
}
