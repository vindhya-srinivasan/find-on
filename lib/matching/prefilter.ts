// Person 3: plain-code pre-filter before rankMatches (Spec > Pre-filter before Task 3).
import type { Building, FoundItemRow, LostReportRow } from '@/types';
import { buildingsWithin } from '@/lib/location';
import { sameCategoryGroup } from './categories';

const DAY = 24 * 3600 * 1000;
const RADIUS_M = 800;
const MAX_CANDIDATES = 10;

export function prefilter(input: { lost: LostReportRow; found: FoundItemRow[]; buildings: Building[] }): FoundItemRow[] {
  const { lost, found, buildings } = input;

  const start = Date.parse(lost.time_start);
  const end = Date.parse(lost.time_end);
  const earliest = Number.isFinite(start) ? start - 1 * DAY : -Infinity;
  const latest = Number.isFinite(end) ? end + 14 * DAY : Infinity;

  // Owner said "not sure", or gave no buildings → skip the location filter.
  const skipLocation = lost.not_sure || lost.building_ids.length === 0;
  const nearby = new Set<string>(lost.building_ids);
  if (!skipLocation) {
    for (const id of lost.building_ids) for (const b of buildingsWithin(id, RADIUS_M, buildings)) nearby.add(b.id);
  }

  return found
    .filter((f) => f.status !== 'returned' && f.status !== 'unclaimed')
    .filter((f) => sameCategoryGroup(f.category, lost.category))
    .filter((f) => {
      const t = Date.parse(f.found_at);
      return !Number.isFinite(t) || (t >= earliest && t <= latest);
    })
    .filter((f) => skipLocation || nearby.has(f.found_building_id))
    .sort((a, b) => (Date.parse(b.found_at) || 0) - (Date.parse(a.found_at) || 0))
    .slice(0, MAX_CANDIDATES);
}
