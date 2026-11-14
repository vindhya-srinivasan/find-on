// Person 1 — fake API responses in the shared types, used until Person 2's routes are live.
// Flip NEXT_PUBLIC_USE_MOCKS=false in .env.local to use the real API.
import type { MatchResult, PublicFoundItem, Question } from '@/types';

export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS !== 'false';

export const mockItems: PublicFoundItem[] = [
  {
    id: 'item-1', item_code: 'FO-4821', public_title: 'Black water bottle · Taper Hall',
    category: 'water bottle', color: 'black', found_building_id: 'thh', found_date: '2026-11-14',
    blurred_thumb_url: '/placeholder-blur.png', status: 'with_finder', return_method: 'finder', held_at_desk_id: null,
  },
];

export const mockMatches: (MatchResult & { item: PublicFoundItem })[] = [
  { candidate_id: 'item-1', score: 82, public_reason: 'Same category and color, found near where you said, within your time window', item: mockItems[0] },
];

export const mockQuestions: Question[] = [
  { id: 'q1', question: 'What brand is it, and roughly what size?', detail_indexes: [0] },
  { id: 'q2', question: 'Describe any stickers, dents or marks on it.', detail_indexes: [1, 2] },
];
