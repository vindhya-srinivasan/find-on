// Person 3: end-to-end check of the full loop against the REAL routes, database and AI (the demo script).
// Owner files lost report → finder analyzes + posts photo at another building → match → claim → quiz →
// pickup code → finder marks returned.
//
// Run:  npm run dev   (in another terminal)   then   npx tsx scripts/e2e.mts
//       E2E_BASE=https://your-deploy.example npx tsx scripts/e2e.mts   to test a deployment
// Needs .env.local with Supabase keys + ANTHROPIC_API_KEY. Creates/reuses two test accounts:
// p3-e2e-owner@usc.edu and p3-e2e-finder@usc.edu (confirmed, no email sent). Each run adds one
// lost report, one found item and one claim to the database.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import type { MatchWithItem, Question } from '@/types';
process.loadEnvFile('.env.local');

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const anon = () => createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
const PW = 'p3-e2e-Test!' + Math.random().toString(36).slice(2, 8);

async function account(email: string, first: string, last: string): Promise<string> {
  const list = await admin.auth.admin.listUsers({ perPage: 200 });
  const existing = list.data.users.find((u) => u.email === email);
  if (existing) await admin.auth.admin.updateUserById(existing.id, { password: PW, email_confirm: true });
  else {
    const c = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { first_name: first, last_initial: last } });
    if (c.error) throw c.error;
  }
  const s = await anon().auth.signInWithPassword({ email, password: PW });
  if (s.error) throw s.error;
  return s.data.session!.access_token;
}

let step = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON from our own routes
async function call(label: string, token: string, method: string, path: string, body?: FormData | object): Promise<any> {
  const t0 = Date.now();
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown; try { data = JSON.parse(text); } catch { data = text.slice(0, 300); }
  console.log(`\n${++step}. ${label}  →  ${res.status} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(JSON.stringify(data, null, 2).slice(0, 1500));
  if (!res.ok) throw new Error(`${label} failed`);
  return data;
}

const owner = await account('p3-e2e-owner@usc.edu', 'Olivia', 'O');
const finder = await account('p3-e2e-finder@usc.edu', 'Finn', 'F');

// 1. Owner reports first (spec demo order) → prefiled bonus.
const lf = new FormData();
lf.append('text', 'blue water bottle with an "embrace the ick" sticker, lost near Viterbi yesterday afternoon');
lf.append('buildingIds', JSON.stringify(['rth']));
lf.append('notSure', 'false');
lf.append('landmarks', JSON.stringify([]));
const lost = await call('Owner files lost report', owner, 'POST', '/api/lost', lf);

// 2. Finder at a different building: analyze, then post.
const photo = () => new File([readFileSync('data/seed/photos/bottle-sticker.jpg')], 'bottle.jpg', { type: 'image/jpeg' });
const af = new FormData(); af.append('photos', photo()); af.append('buildingId', 'lvl'); af.append('landmark', '2nd floor');
const analysis = await call('Finder analyzes photo', finder, 'POST', '/api/found/analyze', af);

const ff = new FormData();
ff.append('photos', photo()); ff.append('buildingId', 'lvl'); ff.append('landmark', '2nd floor');
ff.append('foundAt', new Date().toISOString()); ff.append('analysis', JSON.stringify(analysis));
ff.append('returnMethod', 'finder'); ff.append('availability', 'weekdays 10-4');
const found = await call('Finder posts item (keeps it)', finder, 'POST', '/api/found', ff);

// 3. Owner sees the match.
const matches = await call('Owner checks matches', owner, 'GET', `/api/lost/${lost.reportId}/matches`);
const match = (matches as MatchWithItem[]).find((m) => m.item.id === found.item.id);
if (!match) throw new Error('found item did not match the lost report');

// 4. Claim + quiz.
const claim = await call('Owner: "This might be mine"', owner, 'POST', '/api/claims', { foundItemId: found.item.id, lostReportId: lost.reportId });
const ANSWERS: Record<number, string> = {};
const answers = (claim.questions as Question[]).map((q, i) => ({
  question_id: q.id,
  answer: ANSWERS[i] ?? (i === 0 ? 'A white sticker that says "embrace the ick" near the bottom' : 'Blue, with a ribbed grip band in the middle and a black push-button flip lid'),
}));
console.log('\n   answering:', answers.map((a) => a.answer));
const graded = await call('Owner submits answers', owner, 'POST', `/api/claims/${claim.claimId}/answers`, { answers });

// 5. Finder enters pickup code.
if (graded.pickupCode) {
  await call('Finder enters pickup code', finder, 'POST', `/api/items/${found.item.id}/return`, { pickupCode: graded.pickupCode });
  await call('Owner views claim after return', owner, 'GET', `/api/claims/${claim.claimId}`);
} else {
  await call('Finder views claim for review', finder, 'GET', `/api/claims/${claim.claimId}`);
}
console.log('\nE2E done ✅');
