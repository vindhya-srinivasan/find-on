// Person 2: owner closes a lost report ("I found it myself"); cancels their open claims.
import { IdParam, error, json } from '@/lib/api';
import { requireUser } from '@/lib/supabase/auth';
import { supabaseAdmin } from '@/lib/supabase/server';

const FAIL = () => error('Something went wrong. Try again.', 500);
const NOT_FOUND = () => error('Lost report not found', 404);
const OPEN_CLAIM = ['awaiting_answers', 'likely_owner', 'needs_review', 'approved'];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser(req, { write: true });
    if (me instanceof Response) return me;

    const { id } = await ctx.params;
    if (!IdParam.safeParse({ id }).success) return NOT_FOUND();
    const db = supabaseAdmin();
    const r = await db.from('lost_reports').select('status').eq('id', id).eq('owner_id', me.id).maybeSingle();
    if (r.error) return FAIL();
    if (!r.data) return NOT_FOUND();
    if (r.data.status !== 'open') return json({ status: r.data.status });

    // Claims first, then the report: a retry after a partial failure redoes both.
    const c = await db.from('claims').update({ status: 'rejected', pickup_code: null }).eq('lost_report_id', id).eq('claimant_id', me.id).in('status', OPEN_CLAIM);
    if (c.error) return FAIL();
    const u = await db.from('lost_reports').update({ status: 'closed' }).eq('id', id).eq('owner_id', me.id).eq('status', 'open');
    if (u.error) return FAIL();

    return json({ status: 'closed' });
  } catch {
    return FAIL();
  }
}
