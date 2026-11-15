// Person 2: report an item, chat message or user. Three distinct reporters pause a student account.
import { ReportBody, badRequest, error, json } from '@/lib/api';
import { requireUser } from '@/lib/supabase/auth';
import { supabaseAdmin } from '@/lib/supabase/server';

const FAIL = () => error('Something went wrong. Try again.', 500);
const NOT_FOUND = () => error('Not found', 404);
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_DAY = 10;
const FLAG_AT = 3;

type Db = ReturnType<typeof supabaseAdmin>;

export async function POST(req: Request) {
  try {
    const me = await requireUser(req, { write: true });
    if (me instanceof Response) return me;

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return error('Invalid JSON', 400);
    }
    const body = ReportBody.safeParse(raw);
    if (!body.success) return badRequest(body.error);
    const { targetType, targetId, reason } = body.data;

    const db = supabaseAdmin();
    const owner = await targetOwner(db, targetType, targetId, me.id);
    if (owner === undefined) return FAIL();
    if (!owner) return NOT_FOUND();
    if (owner === me.id) return error("You can't report yourself.", 400);

    // shortcut: read-then-write, two parallel requests can both pass the 10-per-day limit; move to a DB constraint if abused
    const recent = await db
      .from('abuse_reports')
      .select('id', { count: 'exact', head: true })
      .eq('reporter_id', me.id)
      .gte('created_at', new Date(Date.now() - DAY_MS).toISOString());
    if (recent.error) return FAIL();
    if ((recent.count ?? 0) >= MAX_PER_DAY) return error("You've reached the limit of 10 reports in 24 hours.", 429);

    const ins = await db.from('abuse_reports').insert({ reporter_id: me.id, target_type: targetType, target_id: targetId, reason });
    if (ins.error) return FAIL();

    await autoFlag(db, owner);
    return json({ ok: true });
  } catch {
    return FAIL();
  }
}

/** The user behind the target: string, null (missing or not visible to the caller), undefined (DB error). */
async function targetOwner(db: Db, type: 'item' | 'message' | 'user', id: string, meId: string): Promise<string | null | undefined> {
  if (type === 'item') {
    const r = await db.from('found_items').select('finder_id').eq('id', id).maybeSingle();
    return r.error ? undefined : ((r.data?.finder_id as string | undefined) ?? null);
  }
  if (type === 'user') {
    const r = await db.from('users').select('id').eq('id', id).maybeSingle();
    return r.error ? undefined : ((r.data?.id as string | undefined) ?? null);
  }
  const m = await db.from('messages').select('sender_id, claim_id').eq('id', id).maybeSingle();
  if (m.error) return undefined;
  if (!m.data) return null;
  const c = await db.from('claims').select('claimant_id, found_item_id').eq('id', m.data.claim_id).maybeSingle();
  if (c.error) return undefined;
  if (!c.data) return null;
  const f = await db.from('found_items').select('finder_id').eq('id', c.data.found_item_id).maybeSingle();
  if (f.error) return undefined;
  // Only the two chat participants may report a message; anyone else learns nothing.
  if (meId !== c.data.claimant_id && meId !== f.data?.finder_id) return null;
  return m.data.sender_id as string;
}

/** Best effort: never fails the report. Desk/admin accounts are never auto-flagged. */
async function autoFlag(db: Db, owner: string) {
  try {
    // shortcut: counts reports on the newest 50 items + 50 messages, add abuse_reports.target_user_id if history grows
    const [items, msgs] = await Promise.all([
      db.from('found_items').select('id').eq('finder_id', owner).order('created_at', { ascending: false }).limit(50),
      db.from('messages').select('id').eq('sender_id', owner).order('created_at', { ascending: false }).limit(50),
    ]);
    if (items.error || msgs.error) throw items.error ?? msgs.error;
    const ids = [owner, ...(items.data ?? []).map((r) => r.id as string), ...(msgs.data ?? []).map((r) => r.id as string)];

    const reps = await db.from('abuse_reports').select('reporter_id').in('target_id', ids);
    if (reps.error) throw reps.error;
    const reporters = new Set((reps.data ?? []).map((r) => r.reporter_id as string));
    reporters.delete(owner);
    if (reporters.size < FLAG_AT) return;

    const up = await db.from('users').update({ flagged: true }).eq('id', owner).eq('role', 'student').eq('flagged', false);
    if (up.error) throw up.error;
  } catch {
    console.warn('auto-flag check failed');
  }
}
