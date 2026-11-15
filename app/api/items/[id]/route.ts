// Person 2: public or privileged view of a found item. Contract: Team Tasks > API routes.
import { connection } from 'next/server';
import { IdParam, error, json } from '@/lib/api';
import { PASSED_CLAIM, handlerRole, publicItemOf, reviewerClaimList, type ClaimRow, type ItemDetailOut } from '@/lib/db';
import { requireUser } from '@/lib/supabase/auth';
import { supabaseAdmin } from '@/lib/supabase/server';
import { signedUrl } from '@/lib/supabase/storage';
import type { FoundItemRow, Viewer } from '@/types';

const FAIL = () => error('Something went wrong. Try again.', 500);
const CODE_RE = /^FO-\d{4}$/i;
const CLAIM_COLS = 'id, found_item_id, lost_report_id, claimant_id, questions, answers, score, reason, flags, status, pickup_code, attempt_no, created_at';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    const byId = IdParam.safeParse({ id }).success;
    if (!byId && !CODE_RE.test(id)) return error('Invalid item id', 400);

    const db = supabaseAdmin();
    const i = await db.from('found_items').select('*').eq(byId ? 'id' : 'item_code', byId ? id : id.toUpperCase()).maybeSingle();
    if (i.error) return FAIL();
    const item = i.data as FoundItemRow | null;
    if (!item) return error('Item not found', 404);

    // Auth is optional here: any auth failure just means the public view.
    const auth = await requireUser(req);
    const me = auth instanceof Response ? null : auth;
    const role = me && handlerRole(me, item);

    let viewer: Viewer = 'public';
    if (me?.id === item.finder_id) viewer = 'finder';
    else if (role === 'desk') viewer = 'desk';
    else if (me) {
      const c = await db.from('claims').select('id').eq('found_item_id', item.id).eq('claimant_id', me.id).in('status', PASSED_CLAIM).limit(1);
      if (c.error) return FAIL();
      if (c.data.length) viewer = 'claimant';
    }

    const publicItem = await publicItemOf(item);
    const out: ItemDetailOut = { ...publicItem, viewer };
    if (viewer !== 'public') {
      out.photo_urls = (await Promise.all(item.photo_paths.map((p) => signedUrl(p, 600)))).filter(Boolean);
      out.hidden_details = item.hidden_details;
      out.landmark = item.landmark;
      out.found_at = item.found_at;
      out.finder_availability = item.finder_availability;
    }
    if (role === 'finder') {
      const c = await db.from('claims').select(CLAIM_COLS).eq('found_item_id', item.id).eq('status', 'needs_review');
      if (c.error) return FAIL();
      out.pending_claims = await reviewerClaimList('finder', c.data as ClaimRow[], new Map([[item.id, publicItem]]));
    }
    return json(out);
  } catch {
    return FAIL();
  }
}
