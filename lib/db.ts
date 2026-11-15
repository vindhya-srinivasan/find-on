// Person 2: database helpers (matching orchestration, claims, statuses). Filled in during backend tasks.
import 'server-only';
import { randomInt } from 'node:crypto';
import sharp from 'sharp';
import { supabaseAdmin } from '@/lib/supabase/server';
import { signedUrl } from '@/lib/supabase/storage';
import { rankMatches } from '@/lib/ai';
import { prefilter } from '@/lib/matching/prefilter';
import type {
  Building, ClaimFlag, ClaimStatus, FoundItemRow, ItemStatus, LostReportRow, MatchResult, MatchWithItem, PublicFoundItem,
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

// Explicit copy, never spread: everything not listed here (hidden_details, photo_paths, finder_id, ...) stays server-side.
export function toPublicFoundItem(row: FoundItemRow, thumbUrl: string): PublicFoundItem {
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

// AI reasons go to the owner before any verification, so they must not leak hidden details or brand.
export function safePublicReason(
  reason: string,
  item: Pick<FoundItemRow, 'category' | 'color' | 'brand' | 'public_title' | 'hidden_details' | 'found_at'>,
  buildingName: string,
): string {
  const allowed = new Set(words([item.category, item.color, item.public_title, buildingName].join(' ')));
  // Length filter only on hidden-detail words: short brands (HP, LG, JBL) must still be banned.
  const banned = [...(item.hidden_details ?? []).flatMap((h) => words(h.detail)).filter((w) => w.length >= 4), ...words(item.brand)].filter(
    (w) => !allowed.has(w),
  );
  // Same word or same stem (sticker/stickers, dent/dented, engraving/engraved); a false positive only falls back to generic.
  const near = (w: string, b: string) =>
    w.startsWith(b) || (w.length >= 4 && b.startsWith(w)) || (w.length >= 5 && b.length >= 5 && w.slice(0, 5) === b.slice(0, 5));
  const r = (reason ?? '').trim();
  const leaks = words(r).some((w) => !allowed.has(w) && banned.some((b) => near(w, b)));
  return !r || r.length > 300 || leaks ? genericReason(item, buildingName) : r;
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
