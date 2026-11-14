// Person 3: plain-code pre-filter before rankMatches. STUB: returns the 10 most recent open items.
import type { Building, FoundItemRow, LostReportRow } from '@/types';

export function prefilter(input: { lost: LostReportRow; found: FoundItemRow[]; buildings: Building[] }): FoundItemRow[] {
  return input.found
    .filter((f) => f.status !== 'returned' && f.status !== 'unclaimed')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 10);
}
