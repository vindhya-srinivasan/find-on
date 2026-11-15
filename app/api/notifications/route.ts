// Person 2: my notifications. Contract: Team Tasks > API routes.
import { connection } from 'next/server';
import { error, json } from '@/lib/api';
import { requireUser } from '@/lib/supabase/auth';
import { supabaseAdmin } from '@/lib/supabase/server';
import type { NotificationItem } from '@/types';

const FAIL = () => error('Something went wrong. Try again.', 500);

export async function GET(req: Request) {
  await connection();
  try {
    const me = await requireUser(req);
    if (me instanceof Response) return me;

    const db = supabaseAdmin();
    const n = await db
      .from('notifications')
      .select('id, text, link, created_at, read')
      .eq('user_id', me.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (n.error) return FAIL();
    const rows = (n.data ?? []) as NotificationItem[];

    // Return rows with their current read flags (UI highlights new ones), then mark exactly these as read.
    const unread = rows.filter((x) => !x.read).map((x) => x.id);
    if (unread.length) {
      const u = await db.from('notifications').update({ read: true }).in('id', unread).eq('user_id', me.id);
      if (u.error) console.warn('notifications mark-read failed');
    }
    return json(rows);
  } catch {
    return FAIL();
  }
}
