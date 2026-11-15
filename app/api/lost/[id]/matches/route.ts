// Person 2: suggested matches for a lost report. Contract: Team Tasks > API routes.
import { connection } from 'next/server';
import { IdParam, error, json } from '@/lib/api';
import { getMatchesForLostReport } from '@/lib/db';
import { requireUser } from '@/lib/supabase/auth';
import { supabaseAdmin } from '@/lib/supabase/server';

const FAIL = () => error('Something went wrong. Try again.', 500);
const NOT_FOUND = () => error('Lost report not found', 404);

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const me = await requireUser(req);
    if (me instanceof Response) return me;

    const { id } = await ctx.params;
    if (!IdParam.safeParse({ id }).success) return NOT_FOUND();
    // Someone else's report is a 404, never 403, so ids can't be probed.
    const r = await supabaseAdmin().from('lost_reports').select('id').eq('id', id).eq('owner_id', me.id).maybeSingle();
    if (r.error) return FAIL();
    if (!r.data) return NOT_FOUND();

    return json(await getMatchesForLostReport(id));
  } catch {
    return FAIL();
  }
}
