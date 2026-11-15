// Person 2: database helpers (matching orchestration, claims, statuses). Filled in during backend tasks.
import 'server-only';
import { randomInt } from 'node:crypto';
import sharp from 'sharp';
import { supabaseAdmin } from '@/lib/supabase/server';
import { signedUrl } from '@/lib/supabase/storage';
import { questionLeaks, rankMatches } from '@/lib/ai';
import { prefilter } from '@/lib/matching/prefilter';
import type { AuthedUser } from '@/lib/supabase/auth';
import type {
  Building, ClaimDetail, ClaimFlag, ClaimStatus, FoundItemRow, HiddenDetail, ItemDetail, ItemStatus, LostReportRow, MatchResult, MatchWithItem,
  PublicFoundItem, Question, ReturnDetails,
} from '@/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const CLAIMABLE: ItemStatus[] = ['en_route_to_desk', 'at_desk', 'with_finder'];
const foundDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' });

export function makeItemCode(): string {
  return 'FO-' + String(randomInt(0, 10000)).padStart(4, '0');
}

export function makePickupCode(): string {
  return String(randomInt(0, 1000000)).padStart(6, '0');
}

type PublicItemSrc = Pick<
  FoundItemRow,
  'id' | 'item_code' | 'public_title' | 'category' | 'color' | 'found_building_id' | 'found_at' | 'status' | 'return_method' | 'held_at_desk_id'
>;
export type PublicItemRow = PublicItemSrc & Pick<FoundItemRow, 'blurred_thumb_path'>;
/** Exactly the columns publicItemOf reads, so list queries never pull hidden_details or photo_paths. */
export const PUBLIC_ITEM_COLS =
  'id, item_code, public_title, category, color, found_building_id, found_at, status, return_method, held_at_desk_id, blurred_thumb_path';

// Explicit copy, never spread: everything not listed here (hidden_details, photo_paths, finder_id, ...) stays server-side.
export function toPublicFoundItem(row: PublicItemSrc, thumbUrl: string): PublicFoundItem {
  return {
    id: row.id,
    item_code: row.item_code,
    public_title: row.public_title,
    category: row.category,
    color: row.color,
    found_building_id: row.found_building_id,
    found_date: foundDateFmt.format(new Date(row.found_at)),
    blurred_thumb_url: thumbUrl,
    status: row.status,
    return_method: row.return_method,
    held_at_desk_id: row.held_at_desk_id,
  };
}

export function blurThumbnail(buffer: Buffer): Promise<Buffer> {
  // rotate() applies EXIF orientation; sharp strips metadata on output, so no EXIF GPS reaches the thumbnail.
  return sharp(buffer).rotate().resize({ width: 320, withoutEnlargement: true }).blur(20).jpeg({ quality: 60 }).toBuffer();
}

export function genericReason(item: Pick<FoundItemRow, 'category' | 'color' | 'found_at'>, buildingName: string): string {
  const what = `${item.color} ${item.category}`.trim();
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} found at ${buildingName} on ${foundDateFmt.format(new Date(item.found_at))}`;
}

const words = (s: string | null | undefined) => (s ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

// Same word or same stem (sticker/stickers, dent/dented, engraving/engraved); a false positive only falls back to generic.
const near = (w: string, b: string) =>
  w.startsWith(b) || (w.length >= 4 && b.startsWith(w)) || (w.length >= 5 && b.length >= 5 && w.slice(0, 5) === b.slice(0, 5));

type LeakItem = Pick<FoundItemRow, 'category' | 'color' | 'brand' | 'public_title' | 'hidden_details'>;

/** True if text mentions a hidden-detail or brand word. Words in category/color/title (+ alsoAllowed) are fine. */
export function leaksHidden(text: string, item: LeakItem, alsoAllowed = ''): boolean {
  const allowed = new Set(words([item.category, item.color, item.public_title, alsoAllowed].join(' ')));
  // Length filter only on hidden-detail words: short brands (HP, LG, JBL) must still be banned.
  const banned = [...(item.hidden_details ?? []).flatMap((h) => words(h.detail)).filter((w) => w.length >= 4), ...words(item.brand)].filter(
    (w) => !allowed.has(w),
  );
  return words(text).some((w) => !allowed.has(w) && banned.some((b) => near(w, b)));
}

// AI reasons go to the owner before any verification, so they must not leak hidden details or brand.
export function safePublicReason(reason: string, item: LeakItem & Pick<FoundItemRow, 'found_at'>, buildingName: string): string {
  const r = (reason ?? '').trim();
  return !r || r.length > 300 || leaksHidden(r, item, buildingName) ? genericReason(item, buildingName) : r;
}

type MatchRow = { lost_report_id: string; found_item_id: string; score: number; public_reason: string; notified: boolean };

// rankMatches with fallback, then threshold: clamp 0..100, keep >= 50, only candidates we sent, dedupe, safe reasons.
async function rankAndKeep(report: LostReportRow, candidates: FoundItemRow[], names: Map<string, string>, notified: boolean): Promise<MatchRow[]> {
  const name = (id: string) => names.get(id) ?? id;
  let results: MatchResult[];
  try {
    results = await rankMatches({
      lost: {
        summary: report.raw_text.slice(0, 500),
        category: report.category, color: report.color, brand: report.brand, marks: report.marks,
        buildingNames: report.building_ids.map(name),
      },
      candidates: candidates.map((c) => ({
        id: c.id, category: c.category, color: c.color, brand: c.brand,
        hidden_details: c.hidden_details, buildingName: name(c.found_building_id), found_at: c.found_at,
      })),
    });
  } catch {
    results = candidates.map((c) => ({ candidate_id: c.id, score: 50, public_reason: genericReason(c, name(c.found_building_id)) }));
  }
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const rows: MatchRow[] = [];
  for (const r of results) {
    const item = byId.get(r.candidate_id);
    const score = Math.min(100, Math.max(0, Math.round(Number(r.score))));
    if (!item || seen.has(item.id) || !(score >= 50)) continue;
    seen.add(item.id);
    rows.push({
      lost_report_id: report.id, found_item_id: item.id, score,
      public_reason: safePublicReason(String(r.public_reason ?? ''), item, name(item.found_building_id)),
      notified,
    });
  }
  return rows;
}

// Returns only newly inserted rows (existing pairs are skipped).
async function insertMatches(rows: MatchRow[]): Promise<{ id: string; lost_report_id: string; found_item_id: string }[]> {
  if (!rows.length) return [];
  const { data, error } = await supabaseAdmin()
    .from('matches')
    .upsert(rows, { onConflict: 'lost_report_id,found_item_id', ignoreDuplicates: true })
    .select('id, lost_report_id, found_item_id');
  if (error) throw new Error('Could not save matches');
  return data ?? [];
}

async function loadBuildings(): Promise<{ buildings: Building[]; names: Map<string, string> }> {
  const { data, error } = await supabaseAdmin().from('buildings').select('id, name, lat, lng, type');
  if (error) throw new Error('Could not load buildings');
  const buildings = (data ?? []) as Building[];
  return { buildings, names: new Map(buildings.map((b) => [b.id, b.name])) };
}

export async function runMatchingForFoundItem(foundItemId: string): Promise<void> {
  const db = supabaseAdmin();
  const it = await db.from('found_items').select('*').eq('id', foundItemId).maybeSingle();
  if (it.error) throw new Error('Could not load item');
  const item = it.data as FoundItemRow | null;
  if (!item || !CLAIMABLE.includes(item.status)) return;

  const { buildings, names } = await loadBuildings();
  // shortcut: caps at 20 newest open reports, move to a queue if reports grow
  const lr = await db
    .from('lost_reports')
    .select('*')
    .eq('status', 'open')
    .neq('owner_id', item.finder_id)
    .order('created_at', { ascending: false })
    .limit(20);
  if (lr.error) throw new Error('Could not load lost reports');

  const results = await Promise.allSettled(
    ((lr.data ?? []) as LostReportRow[]).map(async (report) => {
      if (!prefilter({ lost: report, found: [item], buildings }).some((f) => f.id === item.id)) return;
      const inserted = await insertMatches(await rankAndKeep(report, [item], names, false));
      if (!inserted.length) return;
      const n = await db.from('notifications').insert({
        user_id: report.owner_id,
        text: `Possible match for your lost ${report.category}: ${item.public_title}`,
        link: `/lost/${report.id}`,
      });
      if (n.error) throw new Error('Could not notify owner');
      const u = await db.from('matches').update({ notified: true }).in('id', inserted.map((m) => m.id));
      if (u.error) throw new Error('Could not mark match notified');
    }),
  );
  if (results.some((r) => r.status === 'rejected')) throw new Error('Matching failed for some reports');
}

export async function runMatchingForLostReport(reportId: string): Promise<MatchWithItem[]> {
  const db = supabaseAdmin();
  const lr = await db.from('lost_reports').select('*').eq('id', reportId).maybeSingle();
  if (lr.error) throw new Error('Could not load lost report');
  const report = lr.data as LostReportRow | null;
  if (!report) return [];

  const { buildings, names } = await loadBuildings();
  // shortcut: newest 500 open items only, move to SQL-side filtering if listings grow
  const fi = await db
    .from('found_items')
    .select('*')
    .in('status', CLAIMABLE)
    .neq('finder_id', report.owner_id)
    .order('created_at', { ascending: false })
    .limit(500);
  if (fi.error) throw new Error('Could not load found items');

  const candidates = prefilter({ lost: report, found: (fi.data ?? []) as FoundItemRow[], buildings });
  if (candidates.length) await insertMatches(await rankAndKeep(report, candidates, names, true));
  return getMatchesForLostReport(reportId);
}

// No ownership check here: routes do that.
export async function getMatchesForLostReport(reportId: string): Promise<MatchWithItem[]> {
  const db = supabaseAdmin();
  const m = await db.from('matches').select('found_item_id, score, public_reason').eq('lost_report_id', reportId);
  if (m.error) throw new Error('Could not load matches');
  const matches = (m.data ?? []) as { found_item_id: string; score: number; public_reason: string }[];
  if (!matches.length) return [];

  const fi = await db.from('found_items').select('*').in('id', matches.map((x) => x.found_item_id)).in('status', CLAIMABLE);
  if (fi.error) throw new Error('Could not load matched items');
  const items = new Map(((fi.data ?? []) as FoundItemRow[]).map((r) => [r.id, r]));

  const out = await Promise.all(
    matches
      .filter((x) => items.has(x.found_item_id))
      .map(async (x) => {
        const row = items.get(x.found_item_id)!;
        return {
          candidate_id: row.id,
          score: x.score,
          public_reason: x.public_reason,
          item: toPublicFoundItem(row, await signedUrl(row.blurred_thumb_path, 3600)),
        };
      }),
  );
  return out.sort((a, b) => b.score - a.score);
}

export function canClaim(input: {
  isFinder: boolean;
  lostReport: Pick<LostReportRow, 'status'> | null;
  claimsLast24h: number;
  priorAttempts: { count: number; lastStatus: ClaimStatus | null; lastAt: string | null };
  itemStatus: ItemStatus;
  now: Date;
}): { ok: true; attemptNo: 1 | 2 } | { ok: false; reason: string; status: number; retryAt?: string } {
  const { isFinder, lostReport, claimsLast24h, priorAttempts, itemStatus, now } = input;
  if (isFinder) return { ok: false, reason: "You reported this item, so you can't claim it.", status: 403 };
  if (!CLAIMABLE.includes(itemStatus)) return { ok: false, reason: 'This item is no longer available to claim.', status: 409 };
  if (lostReport?.status !== 'open') return { ok: false, reason: 'File a lost report before claiming an item.', status: 400 };

  let attemptNo: 1 | 2 = 1;
  if (priorAttempts.count >= 2) return { ok: false, reason: "You've used both attempts on this item.", status: 409 };
  if (priorAttempts.count === 1) {
    if (priorAttempts.lastStatus !== 'rejected') return { ok: false, reason: 'You already have a claim on this item.', status: 409 };
    const retryMs = Date.parse(priorAttempts.lastAt ?? '') + DAY_MS;
    // NaN (missing/bad lastAt) fails closed.
    if (!(now.getTime() >= retryMs)) {
      return {
        ok: false,
        reason: 'You can try again 24 hours after your last attempt.',
        status: 409,
        ...(Number.isFinite(retryMs) && { retryAt: new Date(retryMs).toISOString() }),
      };
    }
    attemptNo = 2;
  }

  if (claimsLast24h >= 3) return { ok: false, reason: "You've reached the limit of 3 claims in 24 hours.", status: 429 };
  return { ok: true, attemptNo };
}

export function canFileLostReport(openCount: number): { ok: true } | { ok: false; reason: string } {
  return openCount >= 5
    ? { ok: false, reason: 'You already have 5 open lost reports. Close one before filing another.' }
    : { ok: true };
}

export function claimFlags(
  item: Pick<FoundItemRow, 'created_at' | 'verifiability'>,
  report: Pick<LostReportRow, 'created_at'>,
): ClaimFlag[] {
  const flags: ClaimFlag[] = [];
  if (Date.parse(report.created_at) > Date.parse(item.created_at)) flags.push('filed_after_listing');
  if (item.verifiability === 'low') flags.push('low_verifiability');
  return flags;
}

export function isPrefiled(report: Pick<LostReportRow, 'created_at'>, item: Pick<FoundItemRow, 'found_at'>): boolean {
  return Date.parse(report.created_at) < Date.parse(item.found_at);
}

// ---- Claims (Phase D) ----

export type ClaimRow = {
  id: string; found_item_id: string; lost_report_id: string; claimant_id: string;
  questions: Question[]; // server-only
  answers: { question_id: string; answer: string }[] | null;
  score: number | null; reason: string | null; flags: ClaimFlag[];
  status: ClaimStatus; pickup_code: string | null; attempt_no: number; created_at: string;
};

export const PASSED_CLAIM: ClaimStatus[] = ['likely_owner', 'approved'];
export const OPEN_CLAIM: ClaimStatus[] = ['awaiting_answers', 'likely_owner', 'needs_review', 'approved'];

type Handled = Pick<FoundItemRow, 'finder_id' | 'return_method' | 'held_at_desk_id'>;

const copyQuestion = (q: Question): Question => ({
  id: q.id, question: q.question, ...(q.hint && { hint: q.hint }), detail_indexes: q.detail_indexes,
});

/** Sanitizes P3's questions. null = something leaked or nothing usable survived (caller regenerates, then genericQuestions). */
export function safeQuestions(raw: unknown, item: LeakItem): Question[] | null {
  if (!Array.isArray(raw)) return null;
  const n = (item.hidden_details ?? []).length;
  const out: Question[] = [];
  for (const q of raw) {
    if (out.length >= 3) break;
    const question = typeof q?.question === 'string' ? q.question.trim() : '';
    // Drop rather than truncate: a cut-off word could slip past the leak check.
    if (!question || question.length > 300) continue;
    const hint = typeof q?.hint === 'string' && q.hint.trim().length <= 200 ? q.hint.trim() : '';
    const idx = Array.isArray(q?.detail_indexes) ? q.detail_indexes : [];
    const detail_indexes = [...new Set<number>(idx.filter((i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < n))];
    if (!detail_indexes.length) continue;
    // P3's questionLeaks: same stem rules as leaksHidden across ALL hidden details, but allows filler and
    // kind-of-detail words ("text", "markings", "front"); leaksHidden rejected ~70% of safe questions.
    // Brand words of any length (HP, JBL) are still banned here.
    const text = `${question} ${hint}`;
    const allowed = [item.category, item.color, item.public_title].join(' ');
    const textWords = new Set<string>(words(text));
    const allowedWords = new Set<string>(words(allowed));
    const brandHit = words(item.brand).some((b) => textWords.has(b) && !allowedWords.has(b));
    if (brandHit || questionLeaks(text, item.hidden_details ?? [], allowed).length) return null;
    out.push({ id: `q${out.length + 1}`, question, ...(hint && { hint }), detail_indexes });
  }
  return out.length ? out : null;
}

/** Same text for every item, so it reveals nothing. */
export function genericQuestions(hiddenCount: number): Question[] {
  return [{
    id: 'q1',
    question: 'Describe your item in as much detail as you can.',
    hint: 'e.g. marks, scratches, stickers, what was inside, anything written on it',
    detail_indexes: Array.from({ length: hiddenCount }, (_, i) => i),
  }];
}

/** Who may review / return this item: its finder (held items) or desk staff of its desk (desk items). */
export function handlerRole(me: Pick<AuthedUser, 'id' | 'role' | 'desk_id'>, item: Handled): 'finder' | 'desk' | null {
  if (item.return_method === 'finder' && me.id === item.finder_id) return 'finder';
  if (item.return_method === 'desk' && me.role === 'desk' && (item.held_at_desk_id === null || item.held_at_desk_id === me.desk_id)) return 'desk';
  return null;
}

export function displayName(u: { first_name: string; last_initial: string }): string {
  return u.last_initial ? `${u.first_name} ${u.last_initial}.` : u.first_name;
}

/** Best effort: a failed notification never fails the request. */
export async function notify(userIds: string[], text: string, link: string): Promise<void> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  try {
    await supabaseAdmin().from('notifications').insert(ids.map((user_id) => ({ user_id, text, link })));
  } catch {
    // ignored on purpose
  }
}

/** For notifications only, so errors give []. */
export async function reviewerIds(item: Handled): Promise<string[]> {
  if (item.return_method === 'finder') return [item.finder_id];
  try {
    let q = supabaseAdmin().from('users').select('id').eq('role', 'desk');
    if (item.held_at_desk_id) q = q.eq('desk_id', item.held_at_desk_id);
    const { data, error } = await q;
    return error ? [] : (data ?? []).map((u) => u.id as string);
  } catch {
    return [];
  }
}

/** Guarded status change that issues a pickup code. Returns the code, or null if the claim was no longer `from`. */
export async function setClaimPassed(
  claimId: string,
  from: ClaimStatus,
  to: 'likely_owner' | 'approved',
  extra?: Partial<Pick<ClaimRow, 'answers' | 'score' | 'reason'>>,
): Promise<string | null> {
  for (let i = 0; i < 5; i++) {
    const pickup_code = makePickupCode();
    const { data, error } = await supabaseAdmin()
      .from('claims')
      .update({ ...extra, status: to, pickup_code })
      .eq('id', claimId)
      .eq('status', from)
      .select('id');
    if (error?.code === '23505') continue; // code already used on this item
    if (error) throw new Error('Could not update claim');
    return data?.length ? pickup_code : null;
  }
  throw new Error('Could not make a pickup code');
}

export async function dpsDeskId(): Promise<string | null> {
  const { data, error } = await supabaseAdmin().from('desks').select('id').ilike('name', '%dps%').order('id').limit(1).maybeSingle();
  if (error) throw new Error('Could not load desk');
  return data?.id ?? null;
}

export async function publicItemOf(row: PublicItemRow): Promise<PublicFoundItem> {
  return toPublicFoundItem(row, await signedUrl(row.blurred_thumb_path, 3600));
}

export async function publicItemsOf(rows: PublicItemRow[]): Promise<Map<string, PublicFoundItem>> {
  const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
  // shortcut: one signing call per item, move to a batch signer if lists grow
  return new Map((await Promise.all(unique.map(publicItemOf))).map((p) => [p.id, p]));
}

export type ClaimDetailOut = ClaimDetail & {
  hidden_details?: HiddenDetail[]; landmark?: string | null; found_at?: string; claimant_name?: string;
};

export type ItemDetailOut = ItemDetail & { found_at?: string; pending_claims?: ClaimDetailOut[] };

/** Finder / desk review fields. Answers carry question text only, never detail_indexes. */
export function reviewerFields(claim: ClaimRow): Pick<ClaimDetail, 'answers' | 'score' | 'reason' | 'flags'> {
  const asked = new Map((claim.questions ?? []).map((q) => [q.id, q.question]));
  return {
    ...(claim.answers && { answers: claim.answers.map((a) => ({ question: asked.get(a.question_id) ?? '', answer: a.answer })) }),
    ...(claim.score !== null && { score: claim.score }),
    ...(claim.reason && { reason: claim.reason }),
    flags: claim.flags ?? [],
  };
}

/** For rejected claims: first attempt may retry 24 h after it was made; second attempt is locked (null). */
export function retryAfter(claim: ClaimRow): string | null {
  return claim.attempt_no === 1 ? new Date(Date.parse(claim.created_at) + DAY_MS).toISOString() : null;
}

/** Lean reviewer list (no return_details). Claims whose item is missing from `items` are skipped. */
export async function reviewerClaimList(
  viewer: 'finder' | 'desk',
  claims: ClaimRow[],
  items: Map<string, PublicFoundItem>,
): Promise<ClaimDetailOut[]> {
  const shown = claims.filter((c) => items.has(c.found_item_id));
  // Finder can't see who claims until verification passes; desk staff always can.
  const named = (c: ClaimRow) => viewer === 'desk' || PASSED_CLAIM.includes(c.status);
  const ids = [...new Set(shown.filter(named).map((c) => c.claimant_id))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data, error } = await supabaseAdmin().from('users').select('id, first_name, last_initial').in('id', ids);
    if (error) throw new Error('Could not load users');
    for (const u of data ?? []) names.set(u.id, displayName(u));
  }
  return shown.map((c) => ({
    id: c.id, status: c.status, viewer, item: items.get(c.found_item_id)!, created_at: c.created_at,
    ...reviewerFields(c),
    ...(named(c) && { claimant_name: names.get(c.claimant_id) ?? 'Someone' }),
  }));
}

async function userName(id: string): Promise<string> {
  const { data, error } = await supabaseAdmin().from('users').select('first_name, last_initial').eq('id', id).maybeSingle();
  if (error) throw new Error('Could not load user');
  return data ? displayName(data) : 'Someone';
}

async function returnDetails(item: FoundItemRow): Promise<ReturnDetails> {
  if (item.return_method === 'finder') {
    return { method: 'finder', finder_name: await userName(item.finder_id), finder_availability: item.finder_availability };
  }
  const deskId = item.held_at_desk_id ?? (await dpsDeskId());
  if (!deskId) return { method: 'desk' };
  const { data, error } = await supabaseAdmin().from('desks').select('name, hours_text').eq('id', deskId).maybeSingle();
  if (error) throw new Error('Could not load desk');
  return data ? { method: 'desk', desk_name: data.name, desk_hours: data.hours_text } : { method: 'desk' };
}

/** GET /api/claims/:id body. Routes check access first; the asserts below only catch a wrong `viewer`. */
export async function buildClaimDetail(
  me: Pick<AuthedUser, 'id' | 'role' | 'desk_id'>,
  claim: ClaimRow,
  item: FoundItemRow,
  viewer: 'claimant' | 'finder' | 'desk',
): Promise<ClaimDetailOut> {
  if (viewer === 'claimant' ? me.id !== claim.claimant_id : handlerRole(me, item) !== viewer) throw new Error('Wrong viewer');
  const passed = PASSED_CLAIM.includes(claim.status) || claim.status === 'returned';
  const out: ClaimDetailOut = { id: claim.id, status: claim.status, viewer, item: await publicItemOf(item), created_at: claim.created_at };

  if (viewer === 'claimant') {
    if (claim.status === 'awaiting_answers') out.questions = (claim.questions ?? []).map(copyQuestion);
    if (claim.status === 'rejected') out.retry_after = retryAfter(claim);
    if (passed) {
      if (claim.pickup_code && PASSED_CLAIM.includes(claim.status)) out.pickup_code = claim.pickup_code;
      out.full_photo_urls = (await Promise.all(item.photo_paths.map((p) => signedUrl(p, 600)))).filter(Boolean);
      out.return_details = await returnDetails(item);
      out.hidden_details = item.hidden_details;
      out.landmark = item.landmark;
      out.found_at = item.found_at;
    }
    return out;
  }

  // Finder / desk: never the pickup code, emails or photo paths.
  Object.assign(out, reviewerFields(claim));
  out.return_details = await returnDetails(item);
  // Finder can't see who claims until verification passes; desk staff always can.
  if (viewer === 'desk' || passed) out.claimant_name = await userName(claim.claimant_id);
  return out;
}
