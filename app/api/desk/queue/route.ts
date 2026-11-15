// Person 2: desk dashboard data (desk role only). Contract: Team Tasks > API routes.
import { connection } from 'next/server';
import { error, json } from '@/lib/api';
import { PUBLIC_ITEM_COLS, handlerRole, publicItemsOf, reviewerClaimList, type ClaimRow, type PublicItemRow } from '@/lib/db';
import { requireUser } from '@/lib/supabase/auth';
import { supabaseAdmin } from '@/lib/supabase/server';
import type { DeskQueue, FoundItemRow } from '@/types';

const FAIL = () => error('Something went wrong. Try again.', 500);

export async function GET(req: Request) {
  await connection();
  try {
    const me = await requireUser(req);
    if (me instanceof Response) return me;
    if (me.role !== 'desk') return error('Desk staff only.', 403);

    const db = supabaseAdmin();
    // finder_id only feeds handlerRole; publicItemsOf never copies it out.
    // shortcut: filter in code over 200 rows, move the desk_id-or-null filter into the query if desks grow
    const r = await db
      .from('found_items')
      .select(`${PUBLIC_ITEM_COLS}, finder_id`)
      .eq('return_method', 'desk')
      .in('status', ['en_route_to_desk', 'at_desk'])
      .order('created_at', { ascending: false })
      .limit(200);
    if (r.error) return FAIL();
    const items = ((r.data ?? []) as unknown as (PublicItemRow & Pick<FoundItemRow, 'finder_id'>)[])
      .filter((i) => handlerRole(me, i) === 'desk');

    let claims: ClaimRow[] = [];
    if (items.length) {
      const c = await db
        .from('claims')
        .select('*')
        .in('found_item_id', items.map((i) => i.id))
        .eq('status', 'needs_review')
        .neq('claimant_id', me.id)
        .order('created_at', { ascending: true });
      if (c.error) return FAIL();
      claims = (c.data ?? []) as ClaimRow[];
    }

    const map = await publicItemsOf(items);
    const reviews = await reviewerClaimList('desk', claims, map);
    const byStatus = (s: FoundItemRow['status']) => items.filter((i) => i.status === s).map((i) => map.get(i.id)!);
    const body: DeskQueue = { en_route: byStatus('en_route_to_desk'), at_desk: byStatus('at_desk'), reviews };
    return json(body);
  } catch {
    return FAIL();
  }
}
