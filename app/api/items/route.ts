// Person 2: recent public listings for the home screen (PublicFoundItem[], newest first, open items only).
import { connection } from 'next/server';
import { error, json } from '@/lib/api';
import { PUBLIC_ITEM_COLS, publicItemsOf, type PublicItemRow } from '@/lib/db';
import { supabaseAdmin } from '@/lib/supabase/server';

const FAIL = () => error('Something went wrong. Try again.', 500);

export async function GET() {
  await connection();
  try {
    const { data, error: dbError } = await supabaseAdmin()
      .from('found_items')
      .select(PUBLIC_ITEM_COLS)
      .in('status', ['en_route_to_desk', 'at_desk', 'with_finder'])
      .order('created_at', { ascending: false })
      .limit(30);
    if (dbError) return FAIL();
    const rows = (data ?? []) as PublicItemRow[];
    const items = await publicItemsOf(rows);
    return json(rows.map((r) => items.get(r.id)!));
  } catch {
    return FAIL();
  }
}
