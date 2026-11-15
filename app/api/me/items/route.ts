// Person 2: my found items, lost reports, claims. Contract: Team Tasks > API routes.
import { connection } from 'next/server';
import { error, json } from '@/lib/api';
import {
  OPEN_CLAIM, PASSED_CLAIM, PUBLIC_ITEM_COLS, publicItemsOf, retryAfter, reviewerClaimList, sweepStale,
  type ClaimDetailOut, type ClaimRow, type PublicItemRow,
} from '@/lib/db';
import { requireUser } from '@/lib/supabase/auth';
import { supabaseAdmin } from '@/lib/supabase/server';
import type { ClaimDetail, ItemStatus, LostReportSummary, MyItems } from '@/types';

const FAIL = () => error('Something went wrong. Try again.', 500);
const CLAIM_COLS =
  'id, found_item_id, lost_report_id, claimant_id, questions, answers, score, reason, flags, status, pickup_code, attempt_no, created_at';
const OPEN_ITEM: ItemStatus[] = ['en_route_to_desk', 'at_desk', 'with_finder'];
const NONE = { data: [], error: null };

type ReportRow = Pick<LostReportSummary, 'id' | 'category' | 'status' | 'created_at'> & { raw_text: string };

export async function GET(req: Request) {
  await connection();
  try {
    const me = await requireUser(req);
    if (me instanceof Response) return me;
    await sweepStale(me.id);
    const db = supabaseAdmin();
    const newest = { ascending: false };

    const [fi, lr, cl] = await Promise.all([
      db.from('found_items').select(PUBLIC_ITEM_COLS).eq('finder_id', me.id).order('created_at', newest).limit(30),
      db.from('lost_reports').select('id, raw_text, category, status, created_at').eq('owner_id', me.id).order('created_at', newest).limit(30),
      db.from('claims').select(CLAIM_COLS).eq('claimant_id', me.id).order('created_at', newest).limit(30),
    ]);
    if (fi.error || lr.error || cl.error) return FAIL();
    const mine = (fi.data ?? []) as PublicItemRow[];
    const reports = (lr.data ?? []) as ReportRow[];
    const myClaims = (cl.data ?? []) as ClaimRow[];

    const heldIds = mine.filter((i) => i.return_method === 'finder').map((i) => i.id);
    const reportIds = reports.map((r) => r.id);
    const [hc, mt] = await Promise.all([
      heldIds.length ? db.from('claims').select(CLAIM_COLS).in('found_item_id', heldIds).in('status', OPEN_CLAIM) : NONE,
      reportIds.length ? db.from('matches').select('lost_report_id, found_item_id').in('lost_report_id', reportIds) : NONE,
    ]);
    if (hc.error || mt.error) return FAIL();
    const held = (hc.data ?? []) as ClaimRow[];
    const matches = (mt.data ?? []) as { lost_report_id: string; found_item_id: string }[];

    const mineIds = new Set(mine.map((i) => i.id));
    const claimItemIds = new Set(myClaims.map((c) => c.found_item_id));
    const extraIds = [...new Set([...claimItemIds, ...matches.map((m) => m.found_item_id)])].filter((id) => !mineIds.has(id));
    const ex = extraIds.length ? await db.from('found_items').select(PUBLIC_ITEM_COLS).in('id', extraIds) : NONE;
    if (ex.error) return FAIL();
    const extra = (ex.data ?? []) as PublicItemRow[];

    const statusOf = new Map([...mine, ...extra].map((r) => [r.id, r.status]));
    // Match-only items are needed just for their status, so only sign thumbs of items we actually return.
    const items = await publicItemsOf([...mine, ...extra.filter((r) => claimItemIds.has(r.id))]);

    const itemOfClaim = new Map(held.map((c) => [c.id, c.found_item_id]));
    const pendingByItem = new Map<string, ClaimDetailOut[]>();
    for (const p of await reviewerClaimList('finder', held, items)) {
      const itemId = itemOfClaim.get(p.id)!;
      pendingByItem.set(itemId, [...(pendingByItem.get(itemId) ?? []), p]);
    }

    const body: MyItems = {
      found: mine.map((r) => ({ ...items.get(r.id)!, pending_claims: pendingByItem.get(r.id) ?? [] })),
      lost: reports.map((r) => ({
        id: r.id,
        summary: r.raw_text.slice(0, 140),
        category: r.category,
        status: r.status,
        created_at: r.created_at,
        match_count: matches.filter((m) => m.lost_report_id === r.id && OPEN_ITEM.includes(statusOf.get(m.found_item_id)!)).length,
      })),
      // Explicit copy: no score, reason, flags or questions; pickup code only my own and only once passed.
      claims: myClaims
        .filter((c) => items.has(c.found_item_id))
        .map((c): ClaimDetail => ({
          id: c.id,
          status: c.status,
          viewer: 'claimant',
          item: items.get(c.found_item_id)!,
          created_at: c.created_at,
          ...(PASSED_CLAIM.includes(c.status) && c.pickup_code ? { pickup_code: c.pickup_code } : {}),
          ...(c.status === 'rejected' ? { retry_after: retryAfter(c) } : {}),
        })),
    };
    return json(body);
  } catch {
    return FAIL();
  }
}
