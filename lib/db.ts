// Person 2: database helpers (matching orchestration, claims, statuses). Filled in during backend tasks.
import 'server-only';
import { randomInt } from 'node:crypto';
import sharp from 'sharp';
import type { ClaimFlag, ClaimStatus, FoundItemRow, ItemStatus, LostReportRow, PublicFoundItem } from '@/types';

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

// Phase C: prefilter + rankMatches over open lost reports; saves matches >= 50 and notifies owners.
export async function runMatchingForFoundItem(foundItemId: string): Promise<void> {
  void foundItemId;
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
