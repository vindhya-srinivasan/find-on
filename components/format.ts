// Person 1: display helpers.
import type { ClaimStatus, ItemStatus } from '@/types';

export const itemStatusLabel: Record<ItemStatus, string> = {
  en_route_to_desk: 'On its way to desk',
  at_desk: 'At desk',
  with_finder: 'With finder',
  returned: 'Returned',
  unclaimed: 'Unclaimed',
};

export const claimStatusLabel: Record<ClaimStatus, string> = {
  awaiting_answers: 'Answer questions',
  likely_owner: 'Verified',
  needs_review: 'Being reviewed',
  rejected: 'Not verified',
  approved: 'Approved',
  returned: 'Returned',
};

export function shortDate(isoOrDate: string) {
  const d = new Date(isoOrDate.length === 10 ? `${isoOrDate}T12:00:00` : isoOrDate);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return shortDate(iso);
}
