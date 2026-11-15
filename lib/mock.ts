// Person 1: the ONE place screens talk to the backend.
// Every function mirrors an API route from Team Tasks > API routes.
// NEXT_PUBLIC_USE_MOCKS=true (default) → in-memory fake data so every screen works before the backend exists.
// NEXT_PUBLIC_USE_MOCKS=false → real fetch calls to /api/*.

import type {
  Building, ChatMessage, ClaimDetail, DeskQueue, ItemDetail, LostReportSummary, MatchWithItem,
  MyItems, NotificationItem, ParsedLostReport, PhotoAnalysis, PublicFoundItem, Question, ReturnMethod,
} from '@/types';
import { deskOf } from '@/components/desks';

export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS !== 'false';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// ---------------------------------------------------------------- real API

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
  }
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}
const postJson = <T>(path: string, body: unknown) =>
  call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ---------------------------------------------------------------- mock data
// Approximate coordinates for demo only. Person 4's data/buildings.json replaces these in real mode.

const mockBuildings: Building[] = [
  { id: 'thh', name: 'Taper Hall (THH)', lat: 34.0222, lng: -118.2846, type: 'academic' },
  { id: 'lvl', name: 'Leavey Library', lat: 34.0217, lng: -118.2829, type: 'library' },
  { id: 'dml', name: 'Doheny Library', lat: 34.0202, lng: -118.2837, type: 'library' },
  { id: 'sal', name: 'Salvatori Computer Science Center', lat: 34.0195, lng: -118.2894, type: 'academic' },
  { id: 'rth', name: 'Ronald Tutor Hall (Viterbi)', lat: 34.0201, lng: -118.2898, type: 'academic' },
  { id: 'lrc', name: 'Lyon Center', lat: 34.0242, lng: -118.2884, type: 'academic' },
  { id: 'vil', name: 'USC Village', lat: 34.0254, lng: -118.2851, type: 'residence' },
  { id: 'tt', name: 'Tommy Trojan', lat: 34.0206, lng: -118.2853, type: 'outdoor' },
  { id: 'mcq', name: 'McCarthy Quad', lat: 34.0214, lng: -118.2838, type: 'outdoor' },
  { id: 'dps', name: 'DPS Lost & Found', lat: 34.0247, lng: -118.2833, type: 'desk' },
];

const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const initialDb = () => ({
  items: [
    { id: 'item-1', item_code: 'FO-4821', public_title: 'Black water bottle · Taper Hall (THH)', category: 'water bottle', color: 'black', found_building_id: 'thh', found_date: today(), blurred_thumb_url: '', status: 'with_finder', return_method: 'finder', held_at_desk_id: null },
    { id: 'item-2', item_code: 'FO-3307', public_title: 'Navy backpack · Leavey Library', category: 'backpack', color: 'navy', found_building_id: 'lvl', found_date: today(), blurred_thumb_url: '', status: 'at_desk', return_method: 'desk', held_at_desk_id: 'dps' },
    { id: 'item-3', item_code: 'FO-1190', public_title: 'White earbuds case · Lyon Center', category: 'earbuds', color: 'white', found_building_id: 'lrc', found_date: today(), blurred_thumb_url: '', status: 'en_route_to_desk', return_method: 'desk', held_at_desk_id: 'dps' },
  ] as PublicFoundItem[],
  lost: [] as (LostReportSummary & { parsed: ParsedLostReport })[],
  claims: [] as ClaimDetail[],
  messages: [] as (ChatMessage & { claim_id: string })[],
  notifications: [
    { id: 'n1', text: 'Welcome to FindOn! Report something you found or lost to get started.', link: '/', created_at: new Date().toISOString(), read: false },
  ] as NotificationItem[],
});

// Mock data survives page reloads (per browser) so a whole flow can be demoed. Clear it with localStorage.removeItem('findon-mock').
const STORE = 'findon-mock';
const db: ReturnType<typeof initialDb> = (() => {
  if (typeof window === 'undefined') return initialDb();
  try { return JSON.parse(localStorage.getItem(STORE) ?? '') as ReturnType<typeof initialDb>; } catch { return initialDb(); }
})();
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(db)); } catch { /* storage unavailable */ } };

// Same wording works for any item: bottles, bags, jackets, keys. The real questions come from each item's own hidden details.
const mockQuestions: Question[] = [
  { id: 'q1', question: 'What brand or make is it?', hint: 'e.g. Hydro Flask, Nike, Apple. Say “not sure” if you don’t know.', detail_indexes: [0] },
  { id: 'q2', question: 'What makes it different from others like it?', hint: 'e.g. a sticker, a scratch, an engraving, a name on it', detail_indexes: [1, 2] },
  { id: 'q3', question: 'What else do you remember about it?', hint: 'e.g. a case, a keychain, what was inside, what was attached', detail_indexes: [3] },
];

const findItem = (id: string) => {
  const it = db.items.find((i) => i.id === id || i.item_code === id);
  if (!it) throw new ApiError('Item not found', 404);
  return it;
};
// A claim on item-1 waiting for its finder's decision. Lives outside db so it shows up even with old saved mock data. No claimant_name: the server only sends it to a finder after the claim passes.
const mockReview: ClaimDetail = {
  id: 'claim-review', status: 'needs_review', viewer: 'finder', item: initialDb().items[0], created_at: new Date().toISOString(),
  score: 58, reason: 'Brand and lid correct; no distinctive detail mentioned.', flags: [],
  answers: [{ question: 'What makes it different from others like it?', answer: 'Not sure, maybe a scratch?' }],
  proof_photo_url: '/icon-192.png', owner_photo_url: '/icon-512.png',
};

const findClaim = (id: string) => {
  const c = db.claims.find((x) => x.id === id) ?? (id === mockReview.id ? mockReview : undefined);
  if (!c) throw new ApiError('Claim not found', 404);
  return c;
};
const notify = (text: string, link: string) =>
  db.notifications.unshift({ id: `n${Date.now()}`, text, link, created_at: new Date().toISOString(), read: false });

// ---------------------------------------------------------------- the API used by screens

export const api = {
  async buildings(): Promise<Building[]> {
    if (!USE_MOCKS) {
      const real = await call<Building[]>('/api/buildings');
      if (real.length) return real;
    }
    return mockBuildings;
  },

  async recentItems(): Promise<PublicFoundItem[]> {
    if (!USE_MOCKS) return call('/api/items');
    return db.items.filter((i) => i.status !== 'returned' && i.status !== 'unclaimed');
  },

  /** POST /api/found/analyze: form: photos[], buildingId, landmark */
  async analyzeFound(form: FormData): Promise<PhotoAnalysis> {
    if (!USE_MOCKS) return call('/api/found/analyze', { method: 'POST', body: form });
    await sleep(1200);
    const b = mockBuildings.find((x) => x.id === form.get('buildingId'));
    return {
      is_valid_item: true, reject_reason: null, category: 'water bottle', color: 'black', brand: 'Hydro Flask',
      public_title: `Black water bottle · ${b?.name ?? 'Campus'}`,
      hidden_details: [
        { detail: 'Hydro Flask, about 32 oz', weight: 2 },
        { detail: 'White "Fight On" sticker near the bottom', weight: 3 },
        { detail: 'Dent on one side', weight: 3 },
        { detail: 'Green straw lid', weight: 2 },
      ],
      verifiability: 'high', is_valuable: false,
    };
  },

  /** POST /api/found: form: photos[], buildingId, landmark, foundAt, analysis (JSON), returnMethod, availability */
  async submitFound(form: FormData): Promise<{ item: PublicFoundItem }> {
    if (!USE_MOCKS) return call('/api/found', { method: 'POST', body: form });
    await sleep(600);
    const a = JSON.parse(String(form.get('analysis'))) as PhotoAnalysis;
    const method = form.get('returnMethod') as ReturnMethod;
    const item: PublicFoundItem = {
      id: `item-${Date.now()}`, item_code: `FO-${Math.floor(1000 + Math.random() * 9000)}`,
      public_title: a.public_title, category: a.category, color: a.color,
      found_building_id: String(form.get('buildingId')), found_date: today(), blurred_thumb_url: '',
      status: method === 'desk' ? 'en_route_to_desk' : 'with_finder', return_method: method,
      held_at_desk_id: method === 'desk' ? String(form.get('deskId') || 'dps') : null,
    };
    db.items.unshift(item);
    save();
    return { item };
  },

  /** POST /api/lost: form: text, buildingIds (JSON), notSure, landmarks (JSON), photo? */
  async submitLost(form: FormData): Promise<{ reportId: string; parsed: ParsedLostReport; matches: MatchWithItem[] }> {
    if (!USE_MOCKS) return call('/api/lost', { method: 'POST', body: form });
    await sleep(1200);
    const text = String(form.get('text'));
    const now = new Date();
    const parsed: ParsedLostReport = {
      category: 'water bottle', color: 'grey', brand: 'Hydro Flask', marks: ['pink sticker'],
      time_start: new Date(now.getTime() - 86400000).toISOString(), time_end: now.toISOString(), summary: text.slice(0, 140),
    };
    const reportId = `lost-${Date.now()}`;
    const matches: MatchWithItem[] = db.items.filter((i) => i.category === 'water bottle').map((item) => ({
      candidate_id: item.id, score: 82, item,
      public_reason: 'Same category and similar color, found close to where you said, within your time window',
    }));
    db.lost.unshift({ id: reportId, summary: parsed.summary, category: parsed.category, status: 'open', created_at: now.toISOString(), match_count: matches.length, parsed });
    save();
    return { reportId, parsed, matches };
  },

  async matches(lostId: string): Promise<MatchWithItem[]> {
    if (!USE_MOCKS) return call(`/api/lost/${lostId}/matches`);
    const r = db.lost.find((l) => l.id === lostId);
    if (!r) return [];
    return db.items.filter((i) => i.category === r.category && i.status !== 'returned').map((item) => ({
      candidate_id: item.id, score: 82, item,
      public_reason: 'Same category and similar color, found close to where you said, within your time window',
    }));
  },

  async closeLost(lostId: string): Promise<{ ok: true }> {
    if (!USE_MOCKS) return postJson(`/api/lost/${lostId}/close`, {});
    const r = db.lost.find((l) => l.id === lostId);
    if (r) r.status = 'closed';
    save();
    return { ok: true };
  },

  async item(id: string): Promise<ItemDetail> {
    if (!USE_MOCKS) return call(`/api/items/${id}`);
    return { ...findItem(id), viewer: 'public' };
  },

  async startClaim(body: { foundItemId: string; lostReportId: string }): Promise<{ claimId: string; questions: Question[] }> {
    if (!USE_MOCKS) return postJson('/api/claims', body);
    await sleep(900);
    const item = findItem(body.foundItemId);
    const claimId = `claim-${Date.now()}`;
    db.claims.unshift({ id: claimId, status: 'awaiting_answers', viewer: 'claimant', item, created_at: new Date().toISOString(), questions: mockQuestions });
    save();
    return { claimId, questions: mockQuestions };
  },

  async submitAnswers(claimId: string, answers: { question_id: string; answer: string }[]): Promise<{ status: ClaimDetail['status']; pickupCode?: string }> {
    if (!USE_MOCKS) return postJson(`/api/claims/${claimId}/answers`, { answers });
    await sleep(1500);
    const c = findClaim(claimId);
    const text = answers.map((a) => a.answer.toLowerCase()).join(' ');
    // Mock rule so you can demo every outcome: mention a sticker → pass; write "review" → review; else reject.
    if (text.includes('sticker')) {
      c.status = 'likely_owner';
      c.pickup_code = String(Math.floor(100000 + Math.random() * 900000));
      c.return_details = c.item.return_method === 'desk'
        ? { method: 'desk', desk_name: deskOf(c.item.held_at_desk_id).name, desk_hours: deskOf(c.item.held_at_desk_id).hours_text }
        : { method: 'finder', finder_name: 'Jordan K.', finder_availability: 'Weekdays 10–4' };
      notify('Your claim passed verification. Your pickup code is ready.', `/claims/${claimId}`);
    } else if (text.includes('review')) {
      c.status = 'needs_review';
    } else {
      c.status = 'rejected';
      c.retry_after = new Date(Date.now() + 86400000).toISOString();
    }
    c.questions = undefined;
    save();
    return { status: c.status, pickupCode: c.pickup_code };
  },

  async claim(id: string): Promise<ClaimDetail> {
    if (!USE_MOCKS) return call(`/api/claims/${id}`);
    return { ...findClaim(id) };
  },

  async reviewClaim(id: string, decision: 'approve' | 'reject'): Promise<{ status: ClaimDetail['status'] }> {
    if (!USE_MOCKS) return postJson(`/api/claims/${id}/review`, { decision });
    const c = findClaim(id);
    c.status = decision === 'approve' ? 'approved' : 'rejected';
    if (decision === 'approve') c.pickup_code = String(Math.floor(100000 + Math.random() * 900000));
    save();
    return { status: c.status };
  },

  async receiveItem(code: string): Promise<{ item: PublicFoundItem }> {
    if (!USE_MOCKS) return postJson(`/api/items/${encodeURIComponent(code.trim().toUpperCase())}/receive`, {});
    const it = findItem(code.trim().toUpperCase());
    it.status = 'at_desk';
    it.held_at_desk_id ??= 'dps';
    save();
    return { item: it };
  },

  async returnItem(itemId: string, pickupCode: string): Promise<{ status: 'returned' }> {
    if (!USE_MOCKS) return postJson(`/api/items/${itemId}/return`, { pickupCode });
    const it = findItem(itemId);
    const c = db.claims.find((x) => x.item.id === it.id && x.pickup_code === pickupCode.trim());
    if (!c) throw new ApiError('That pickup code doesn’t match this item.', 400);
    it.status = 'returned';
    c.status = 'returned';
    save();
    return { status: 'returned' };
  },

  async switchToDesk(itemId: string): Promise<{ item: PublicFoundItem }> {
    if (!USE_MOCKS) return postJson(`/api/items/${itemId}/return-method`, { returnMethod: 'desk' });
    const it = findItem(itemId);
    it.return_method = 'desk';
    it.status = 'en_route_to_desk';
    it.held_at_desk_id = 'dps';
    save();
    return { item: it };
  },

  async messages(claimId: string): Promise<ChatMessage[]> {
    if (!USE_MOCKS) return call(`/api/claims/${claimId}/messages`);
    return db.messages.filter((m) => m.claim_id === claimId);
  },

  async sendMessage(claimId: string, body: string): Promise<ChatMessage[]> {
    if (!USE_MOCKS) return postJson(`/api/claims/${claimId}/messages`, { body });
    db.messages.push({ id: `m${Date.now()}`, claim_id: claimId, mine: true, sender_name: 'You', body, created_at: new Date().toISOString() });
    save();
    return db.messages.filter((m) => m.claim_id === claimId);
  },

  async myItems(): Promise<MyItems> {
    if (!USE_MOCKS) return call('/api/me/items');
    return {
      found: db.items.slice(0, 1).map((i) => ({ ...i, pending_claims: i.id === mockReview.item.id ? [mockReview] : [] })),
      lost: db.lost,
      claims: db.claims,
    };
  },

  async notifications(): Promise<NotificationItem[]> {
    if (!USE_MOCKS) return call('/api/notifications');
    return db.notifications;
  },

  async deskQueue(): Promise<DeskQueue> {
    if (!USE_MOCKS) return call('/api/desk/queue');
    return {
      desk_id: 'dps',
      en_route: db.items.filter((i) => i.status === 'en_route_to_desk'),
      at_desk: db.items.filter((i) => i.status === 'at_desk'),
      reviews: db.claims.filter((c) => c.status === 'needs_review').map((c) => ({
        ...c, viewer: 'desk', score: 55, reason: 'Brand and lid correct; no distinctive detail mentioned.',
        claimant_name: 'Alex R.', proof_photo_url: '/icon-192.png', owner_photo_url: '/icon-512.png',
        answers: [{ question: 'Describe any stickers, dents or marks on it.', answer: 'Not sure, maybe a scratch?' }],
      })),
    };
  },
};
