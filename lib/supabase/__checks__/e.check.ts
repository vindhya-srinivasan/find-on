// Phase E read-route check (/api/items, /api/items/:id, /api/me/items, /api/desk/queue). Needs `npm run dev` up (or BASE_URL): npx tsx lib/supabase/__checks__/e.check.ts
/* eslint-disable @typescript-eslint/no-explicit-any -- probes untyped JSON responses on purpose */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';

let failed = 0;
function check(label: string, pass: boolean, detail?: string) {
  if (!pass) failed++;
  console.log(pass ? `ok ${label}` : `FAIL ${label}${detail ? `: ${detail}` : ''}`);
}

// Mirrors PublicFoundItem / ItemDetail / LostReportSummary / Question in types/index.ts (no app imports here on purpose).
const PUBLIC_KEYS = [
  'id', 'item_code', 'public_title', 'category', 'color', 'found_building_id', 'found_date',
  'blurred_thumb_url', 'status', 'return_method', 'held_at_desk_id',
].sort();
const PUBLIC_VIEW_KEYS = [...PUBLIC_KEYS, 'viewer'].sort();
const FOUND_KEYS = [...PUBLIC_KEYS, 'pending_claims'].sort();
const LOST_KEYS = ['id', 'summary', 'category', 'status', 'created_at', 'match_count'].sort();
const QUESTION_KEYS = ['id', 'question', 'hint', 'detail_indexes'];
const REVIEW_KEYS = ['id', 'status', 'viewer', 'item', 'created_at', 'answers', 'score', 'reason', 'flags', 'claimant_name'];
const MY_CLAIM_KEYS = ['id', 'status', 'viewer', 'item', 'created_at', 'pickup_code', 'retry_after'];
// Names contain zz-test so the notification cleanup (text ilike '%zz-test%') also catches real desk users' rows.
const BUILDING = 'zz-test-e';
const DESK = 'zz-test-desk-e'; // must not contain "dps": /api/found picks the DPS desk by name
const OTHER_CODE = '135790'; // C's pickup code: must never reach anyone
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

type Res = { status: number; text: string; body: any };
// Every response, for the final PII / pickup-code scan.
const seen: { token?: string; what: string; res: Res }[] = [];
async function call(method: 'GET' | 'POST', path: string, token?: string, body?: FormData | string | object): Promise<Res> {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  let payload: FormData | string | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const r = await fetch(BASE + path, { method, body: payload, headers });
  const text = await r.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // non-JSON body; checks report the status
  }
  const res = { status: r.status, text, body: parsed };
  seen.push({ token, what: `${method} ${path}`, res });
  return res;
}
const short = (r: Res) => `${r.status} ${r.text.slice(0, 200)}`;
const sameKeys = (o: any, keys: string[]) => !!o && typeof o === 'object' && JSON.stringify(Object.keys(o).sort()) === JSON.stringify(keys);
const keysWithin = (o: any, keys: string[]) => !!o && typeof o === 'object' && Object.keys(o).every((k) => keys.includes(k));
const arr = (x: any): any[] => (Array.isArray(x) ? x : []);
const signedUrls = (x: any) => Array.isArray(x) && x.length > 0 && x.every((u: any) => typeof u === 'string' && u.includes('token='));

// Each step independent so one failure doesn't strand the rest. FK order: claims (messages cascade), reports, items, notifications.
async function purge(service: SupabaseClient, userIds: string[]) {
  const step = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.log(`cleanup ${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const ok = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };
  if (userIds.length) {
    const items = await service.from('found_items').select('id, photo_paths, blurred_thumb_path').in('finder_id', userIds);
    const itemIds = (items.data ?? []).map((r) => r.id);
    await step('claims (claimants)', async () => ok(await service.from('claims').delete().in('claimant_id', userIds)));
    if (itemIds.length) await step('claims (items)', async () => ok(await service.from('claims').delete().in('found_item_id', itemIds)));
    await step('lost_reports', async () => ok(await service.from('lost_reports').delete().in('owner_id', userIds)));
    await step('found_items', async () => {
      if (items.error) throw new Error(items.error.message);
      const paths = (items.data ?? []).flatMap((r) => [...(r.photo_paths ?? []), r.blurred_thumb_path]).filter(Boolean);
      if (paths.length) await service.storage.from('photos').remove(paths);
      ok(await service.from('found_items').delete().in('finder_id', userIds)); // matches cascade
    });
    await step('notifications (users)', async () => ok(await service.from('notifications').delete().in('user_id', userIds)));
  }
  await step('notifications (zz-test)', async () => ok(await service.from('notifications').delete().ilike('text', '%zz-test%')));
}

// After users are gone (users.desk_id references desks; desks reference buildings).
async function dropAuthUsers(service: SupabaseClient, userIds: string[]) {
  for (const id of userIds) {
    try {
      // public.users cascades from auth.users
      await service.auth.admin.deleteUser(id);
    } catch (e) {
      console.log(`cleanup auth user failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const d = await service.from('desks').delete().eq('id', DESK);
  if (d.error) console.log(`cleanup desk failed: ${d.error.message}`);
  const b = await service.from('buildings').delete().eq('id', BUILDING);
  if (b.error) console.log(`cleanup building failed: ${b.error.message}`);
}

async function main() {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // fine: vars may already be in the environment
  }
  const names = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
  let missing = false;
  for (const n of names) {
    const has = !!process.env[n]?.trim();
    if (!has) missing = true;
    console.log(has ? `ok env ${n}` : `FAIL env ${n} missing`);
  }
  if (missing) process.exit(1);

  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, '');
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, opts);

  const created: string[] = [];

  try {
    // ---- Setup ----
    // Stale leftovers from older runs (best effort).
    try {
      const { data } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const stale = (data?.users ?? []).filter((u) => u.email?.startsWith('fo-check-')).map((u) => u.id);
      await purge(service, stale);
      await dropAuthUsers(service, stale);
    } catch {
      // best effort
    }
    // Off-campus coordinates so matching never pairs test items with real lost reports by distance.
    const bIns = await service.from('buildings').insert({ id: BUILDING, name: BUILDING, lat: 0, lng: 0, type: 'academic' });
    check('setup insert building', !bIns.error, bIns.error?.message);
    const dIns = await service.from('desks').insert({ id: DESK, name: DESK, building_id: BUILDING, hours_text: 'Mon-Fri 9-5' });
    check('setup insert desk', !dIns.error, dIns.error?.message);

    const rand = randomBytes(4).toString('hex');
    const people = {
      A: { first_name: 'Alice', last_initial: 'O' }, // owner
      B: { first_name: 'Bob', last_initial: 'F' }, // finder
      C: { first_name: 'Cara', last_initial: 'X' }, // other user
      D: { first_name: 'Dana', last_initial: 'K' }, // desk staff of DESK
    };
    const tokens: Record<string, string> = {};
    const ids: Record<string, string> = {};
    const emails: Record<string, string> = {};
    for (const [key, meta] of Object.entries(people)) {
      const email = `fo-check-${rand}-${key.toLowerCase()}@usc.edu`;
      emails[key] = email;
      const password = randomBytes(18).toString('base64url');
      const cu = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta });
      if (cu.error || !cu.data.user) {
        check(`setup create user ${key}`, false, cu.error?.message);
        continue;
      }
      created.push(cu.data.user.id);
      ids[key] = cu.data.user.id;
      if (key === 'D') {
        // Before its first API call, so requireUser finds the desk row instead of inserting a student.
        const up = await service.from('users').upsert({ id: ids.D, email, ...meta, role: 'desk', desk_id: DESK }, { onConflict: 'id' });
        check('setup desk users row', !up.error, up.error?.message);
      }
      const si = await createClient(url, anonKey, opts).auth.signInWithPassword({ email, password });
      check(`setup sign in ${key}`, !!si.data.session, si.error?.message);
      if (si.data.session) tokens[key] = si.data.session.access_token;
    }
    const { A, B, C, D } = tokens;
    const aId = ids.A ?? '';
    const cId = ids.C ?? '';
    if (!A || !B || !C || !D) throw new Error('setup failed: no tokens');
    // First API call creates the students' users rows.
    for (const k of ['A', 'B', 'C', 'D']) {
      const n = await call('GET', '/api/notifications', tokens[k]);
      check(`setup ${k} first call -> 200`, n.status === 200, short(n));
    }
    const dRow = await service.from('users').select('role, desk_id').eq('id', ids.D).maybeSingle();
    check('setup desk user still role desk', dRow.data?.role === 'desk' && dRow.data?.desk_id === DESK, JSON.stringify(dRow.data));

    const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 90, g: 90, b: 140 } } }).jpeg().toBuffer();
    const secret = {
      d1: `HDA${rand} sticker`,
      d2: `HDB${rand} dent`,
      d3: `HDC${rand} keychain`,
      brand: `ZBR${rand}`,
      landmark: `LMK${rand}`,
    };
    const emailBan: [string, string][] = Object.entries(emails).map(([k, e]) => [`email ${k}`, e]);
    // Never in a public-view response.
    const PRIVATE: [string, string][] = [
      ['detail 1', `HDA${rand}`], ['detail 2', `HDB${rand}`], ['detail 3', `HDC${rand}`],
      ['brand', secret.brand], ['landmark', secret.landmark], ['photo_paths', 'photo_paths'],
      ['hidden_details', 'hidden_details'], ['blurred_thumb_path', 'blurred_thumb_path'], ['finder_id', 'finder_id'],
      ...emailBan,
    ];
    // Never in any response, to anyone.
    const PII: [string, string][] = [['photo_paths', 'photo_paths'], ['blurred_thumb_path', 'blurred_thumb_path'], ...emailBan];
    // Reviewer lists carry the claimant's answers (which quote the details), but never item internals.
    const REVIEWER: [string, string][] = [
      ...PII, ['brand', secret.brand], ['landmark', secret.landmark], ['hidden_details', 'hidden_details'],
      ['finder_id', 'finder_id'], ['claimant id', aId],
    ];
    const leakCheck = (label: string, r: Res, banned: [string, string][]) => {
      const hits = banned.filter(([, s]) => s && r.text.includes(s)).map(([l]) => l);
      check(`${label} leaks nothing`, hits.length === 0, `contains ${hits.join(', ')}`);
    };

    const postItem = async (label: string, details: { detail: string; weight: number }[], returnMethod: 'desk' | 'finder') => {
      const fd = new FormData();
      fd.append('photos', new File([new Uint8Array(jpeg)], 'item.jpg', { type: 'image/jpeg' }));
      fd.append('buildingId', BUILDING);
      fd.append('landmark', secret.landmark);
      fd.append('foundAt', new Date().toISOString());
      fd.append('analysis', JSON.stringify({
        is_valid_item: true, reject_reason: null, category: 'water bottle', color: 'grey', brand: secret.brand,
        public_title: 'Grey water bottle', hidden_details: details, verifiability: 'high', is_valuable: false,
      }));
      fd.append('returnMethod', returnMethod);
      if (returnMethod === 'finder') fd.append('availability', 'weekdays 2-4pm');
      const r = await call('POST', '/api/found', B, fd);
      check(`${label} B posts item -> 200`, r.status === 200 && !!r.body?.item?.id, short(r));
      return { id: String(r.body?.item?.id ?? ''), code: String(r.body?.item?.item_code ?? '') };
    };
    const lostText = 'Grey water bottle, lost today zz-test';
    const lostForm = () => {
      const fd = new FormData();
      const fields = { text: lostText, buildingIds: JSON.stringify([BUILDING]), notSure: 'false', landmarks: '[]' };
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      return fd;
    };
    const insertReport = async (label: string, ownerId: string, createdAt?: string) => {
      const now = new Date().toISOString();
      const r = await service
        .from('lost_reports')
        .insert({
          owner_id: ownerId, raw_text: 'zz-test grey water bottle', category: 'water bottle', color: 'grey',
          building_ids: [BUILDING], time_start: now, time_end: now, ...(createdAt && { created_at: createdAt }),
        })
        .select('id')
        .single();
      check(`setup ${label}`, !r.error, r.error?.message);
      return String(r.data?.id ?? '');
    };
    const answersFor = (qs: any[], text: string) => ({ answers: qs.map((q) => ({ question_id: q?.id, answer: text })) });
    const fullAnswer = `It has ${secret.d1} and ${secret.d2} and ${secret.d3}`;
    const questionsOk = (qs: any) =>
      Array.isArray(qs) && qs.length >= 1 && qs.length <= 3 &&
      qs.every((q: any) => keysWithin(q, QUESTION_KEYS) && typeof q.id === 'string' && typeof q.question === 'string' && Array.isArray(q.detail_indexes));
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const publicView = (label: string, r: Res, id: string, extraBan: [string, string][] = []) => {
      check(`${label} -> 200 public view`, r.status === 200 && r.body?.id === id && r.body?.viewer === 'public', short(r));
      check(`${label} keys == PublicFoundItem + viewer`, sameKeys(r.body, PUBLIC_VIEW_KEYS), JSON.stringify(r.body && Object.keys(r.body)));
      leakCheck(label, r, [...PRIVATE, ...extraBan]);
    };
    const privileged = (label: string, r: Res, id: string, viewer: string) => {
      check(`${label} -> 200 viewer ${viewer}`, r.status === 200 && r.body?.id === id && r.body?.viewer === viewer, short(r));
      check(`${label} photo_urls signed`, signedUrls(r.body?.photo_urls), JSON.stringify(r.body?.photo_urls)?.slice(0, 120));
      check(`${label} hidden_details + landmark + found_at + finder_availability`,
        arr(r.body?.hidden_details).length > 0 && r.body?.landmark === secret.landmark && typeof r.body?.found_at === 'string' &&
        r.body?.finder_availability !== undefined, short(r));
      leakCheck(label, r, [...PII, ['finder id', ids.B]]);
    };

    // ---- 1. A files a lost report; B posts held H, desk E1, desk E2 (1 detail), spare S ----
    const lr = await call('POST', '/api/lost', A, lostForm());
    const reportA1: string = lr.body?.reportId ?? '';
    check('1 A files lost report -> 200', lr.status === 200 && !!reportA1, short(lr));
    const H = await postItem('1 H', [{ detail: secret.d1, weight: 3 }, { detail: secret.d2, weight: 2 }], 'finder');
    const E1 = await postItem('1 E1', [{ detail: secret.d1, weight: 3 }, { detail: secret.d2, weight: 2 }], 'desk');
    const E2 = await postItem('1 E2', [{ detail: secret.d3, weight: 3 }], 'desk');
    const S = await postItem('1 S', [{ detail: secret.d1, weight: 3 }, { detail: secret.d2, weight: 2 }], 'desk');

    // ---- 2. /api/items (anon) ----
    const li = await call('GET', '/api/items');
    const list = arr(li.body);
    check('2 GET /api/items anon -> 200 array', li.status === 200 && Array.isArray(li.body), short(li));
    check('2 /api/items contains H and S', list.some((i) => i?.id === H.id) && list.some((i) => i?.id === S.id), `${list.length} items`);
    check('2 /api/items every element keys == PublicFoundItem', list.length > 0 && list.every((i) => sameKeys(i, PUBLIC_KEYS)), JSON.stringify(list.find((i) => !sameKeys(i, PUBLIC_KEYS)) ?? null).slice(0, 200));
    check('2 /api/items only open items, max 30', list.length <= 30 && list.every((i) => ['en_route_to_desk', 'at_desk', 'with_finder'].includes(i?.status)), `${list.length}`);
    leakCheck('2 /api/items', li, PRIVATE);
    const sr = await service.from('found_items').update({ status: 'returned' }).eq('id', S.id);
    check('setup S returned', !sr.error, sr.error?.message);
    const li2 = await call('GET', '/api/items');
    check('2 returned S absent from /api/items, H still there', li2.status === 200 && !arr(li2.body).some((i) => i?.id === S.id) && arr(li2.body).some((i) => i?.id === H.id), short(li2));

    // ---- 3. /api/items/:id errors + item code lookup ----
    const e1 = await call('GET', '/api/items/not-a-uuid');
    check("3 GET /api/items/not-a-uuid -> 400 'Invalid item id'", e1.status === 400 && e1.body?.error === 'Invalid item id', short(e1));
    const e2 = await call('GET', '/api/items/FO-12');
    check("3 GET /api/items/FO-12 -> 400 'Invalid item id'", e2.status === 400 && e2.body?.error === 'Invalid item id', short(e2));
    const e3 = await call('GET', `/api/items/${randomUUID()}`);
    check("3 GET /api/items/<random uuid> -> 404 'Item not found'", e3.status === 404 && e3.body?.error === 'Item not found', short(e3));
    const byCode = await call('GET', `/api/items/${H.code.toLowerCase()}`);
    check('3 GET /api/items/<H code lowercase> -> 200 same id', byCode.status === 200 && byCode.body?.id === H.id && byCode.body?.item_code === H.code, short(byCode));
    leakCheck('3 item by code (anon)', byCode, PRIVATE);

    // ---- 4. /api/items/H before any claim passes ----
    publicView('4 anon GET H', await call('GET', `/api/items/${H.id}`), H.id);
    publicView('4 C GET H', await call('GET', `/api/items/${H.id}`, C), H.id);
    const hb = await call('GET', `/api/items/${H.id}`, B);
    privileged('4 B GET H', hb, H.id, 'finder');
    check('4 B finder_availability + pending_claims array', hb.body?.finder_availability === 'weekdays 2-4pm' && Array.isArray(hb.body?.pending_claims), short(hb));
    publicView('4 D (desk) GET finder-held H', await call('GET', `/api/items/${H.id}`, D), H.id);

    const cl = await call('POST', '/api/claims', A, { foundItemId: H.id, lostReportId: reportA1 });
    const heldClaim: string = cl.body?.claimId ?? '';
    const heldQs: any[] = arr(cl.body?.questions);
    check('4 A claims H -> 200 { claimId, questions }', cl.status === 200 && !!heldClaim && sameKeys(cl.body, ['claimId', 'questions']) && questionsOk(heldQs), short(cl));
    publicView('4 A GET H while awaiting_answers', await call('GET', `/api/items/${H.id}`, A), H.id);
    const dcl = await call('POST', '/api/claims', D, { foundItemId: H.id, lostReportId: reportA1 });
    check(`4 D POST /api/claims -> 403 "Desk accounts can't claim items."`, dcl.status === 403 && dcl.body?.error === "Desk accounts can't claim items.", short(dcl));

    // ---- 5. after A passes ----
    const an = await call('POST', `/api/claims/${heldClaim}/answers`, A, answersFor(heldQs, fullAnswer));
    check('5 A answers -> 200', an.status === 200 && typeof an.body?.status === 'string', short(an));
    let heldCode: string = an.body?.pickupCode ?? '';
    if (!(an.body?.status === 'likely_owner' && /^\d{6}$/.test(heldCode))) {
      heldCode = String(randomInt(0, 1000000)).padStart(6, '0');
      if (heldCode === OTHER_CODE) heldCode = '024680';
      const f = await service.from('claims').update({ status: 'likely_owner', pickup_code: heldCode }).eq('id', heldClaim);
      console.log(`NOTE: forced likely_owner via service key (got ${an.body?.status ?? an.status})`);
      check('5 setup force likely_owner', !f.error, f.error?.message);
    }
    const ha = await call('GET', `/api/items/${H.id}`, A);
    privileged('5 A (passed claimant) GET H', ha, H.id, 'claimant');
    check('5 A sees no pending_claims', ha.body?.pending_claims === undefined, short(ha));
    publicView('5 C GET H after A passed', await call('GET', `/api/items/${H.id}`, C), H.id, [['pickup code', heldCode]]);
    const self = await call('POST', `/api/items/${H.id}/return`, A, { pickupCode: heldCode });
    // Handler check runs before the code lookup, so a non-handler can't use return as a pickup-code oracle.
    check("5 A (non-handler) returns with own pickup code -> 404 'Item not found'", self.status === 404 && self.body?.error === 'Item not found', short(self));
    const hs = await service.from('found_items').select('status').eq('id', H.id).maybeSingle();
    check('5 db H still with_finder', hs.data?.status === 'with_finder', `${hs.data?.status}`);
    const hcs = await service.from('claims').select('status').eq('id', heldClaim).maybeSingle();
    check("5 db A's claim still likely_owner", hcs.data?.status === 'likely_owner', `${hcs.data?.status}`);

    // ---- 6. /me/items for A (claims so far: H; the rejected filler on E1 makes 2; E2 in step 11 makes 3) ----
    const fil = await service
      .from('claims')
      .insert({ found_item_id: E1.id, lost_report_id: reportA1, claimant_id: aId, status: 'rejected', attempt_no: 1 })
      .select('id')
      .single();
    check('setup rejected filler claim', !fil.error, fil.error?.message);
    const filler = String(fil.data?.id ?? '');
    const ma = await call('GET', '/api/me/items', A);
    check('6 A /me/items -> 200 keys found, lost, claims', ma.status === 200 && sameKeys(ma.body, ['claims', 'found', 'lost']), short(ma));
    const aLost = arr(ma.body?.lost);
    check('6 A lost[] keys == LostReportSummary, numeric match_count', aLost.length > 0 && aLost.every((l) => sameKeys(l, LOST_KEYS) && typeof l.match_count === 'number'), JSON.stringify(aLost[0] ?? null).slice(0, 200));
    const aRep = aLost.find((l) => l?.id === reportA1);
    check('6 A lost report summary = raw text (<=140), status open', aRep?.summary === lostText.slice(0, 140) && aRep?.status === 'open', JSON.stringify(aRep ?? null));
    const aClaims = arr(ma.body?.claims);
    const mH = aClaims.find((c) => c?.id === heldClaim);
    check("6 A claim on H has A's own pickup_code", mH?.status === 'likely_owner' && mH?.pickup_code === heldCode && mH?.viewer === 'claimant', JSON.stringify(mH ?? null).slice(0, 200));
    check('6 A claims lean (no score/reason/flags/questions/answers), item keys == PublicFoundItem',
      aClaims.length > 0 && aClaims.every((c) => keysWithin(c, MY_CLAIM_KEYS) && sameKeys(c.item, PUBLIC_KEYS)), JSON.stringify(aClaims[0] ?? null).slice(0, 200));
    const mF = aClaims.find((c) => c?.id === filler);
    check('6 rejected filler has string retry_after, no pickup_code', mF?.status === 'rejected' && typeof mF?.retry_after === 'string' && mF?.pickup_code === undefined, JSON.stringify(mF ?? null).slice(0, 200));
    check('6 A found[] is an array', Array.isArray(ma.body?.found), short(ma));
    leakCheck('6 A /me/items', ma, [...PRIVATE, ['finder id', ids.B]]);

    // ---- 7. /me/items for B ----
    const mb = await call('GET', '/api/me/items', B);
    check('7 B /me/items -> 200 keys found, lost, claims', mb.status === 200 && sameKeys(mb.body, ['claims', 'found', 'lost']), short(mb));
    const bFound = arr(mb.body?.found);
    check('7 B found[] keys == PublicFoundItem + pending_claims', bFound.length > 0 && bFound.every((f) => sameKeys(f, FOUND_KEYS) && Array.isArray(f.pending_claims)), JSON.stringify(bFound[0] && Object.keys(bFound[0])));
    const bH = bFound.find((f) => f?.id === H.id);
    const pc = arr(bH?.pending_claims).find((c) => c?.id === heldClaim);
    check("7 B's H pending_claims has A's claim as 'Alice O.', no pickup_code", pc?.claimant_name === 'Alice O.' && pc?.pickup_code === undefined && pc?.viewer === 'finder', JSON.stringify(pc ?? null).slice(0, 200));
    check('7 B pending_claims reviewer-lean keys', arr(bH?.pending_claims).every((c) => keysWithin(c, REVIEW_KEYS)), JSON.stringify(pc && Object.keys(pc)));
    const bDesk = bFound.filter((f) => f?.id === E1.id || f?.id === E2.id);
    check('7 B desk items E1, E2 have pending_claims []', bDesk.length === 2 && bDesk.every((f) => f.pending_claims.length === 0), JSON.stringify(bDesk.map((f) => f.pending_claims)));
    leakCheck('7 B /me/items', mb, [...REVIEWER, ['pickup code', heldCode]]);

    // ---- 8. C's passed claim on a second held item H2: its code reaches nobody ----
    const H2 = await postItem('8 H2', [{ detail: secret.d1, weight: 3 }, { detail: secret.d2, weight: 2 }], 'finder');
    const reportC = await insertReport('C lost report', cId, hourAgo);
    const cc = await service
      .from('claims')
      .insert({ found_item_id: H2.id, lost_report_id: reportC, claimant_id: cId, status: 'likely_owner', pickup_code: OTHER_CODE, attempt_no: 1 })
      .select('id')
      .single();
    check("setup C's likely_owner claim on H2", !cc.error, cc.error?.message);
    const h2b = await call('GET', `/api/items/${H2.id}`, B);
    check("8 B GET H2 -> finder, pending_claims excludes C's likely_owner claim", h2b.status === 200 && h2b.body?.viewer === 'finder' && Array.isArray(h2b.body?.pending_claims) && !h2b.body.pending_claims.some((c: any) => c?.id === cc.data?.id), short(h2b));
    publicView('8 A GET H2', await call('GET', `/api/items/${H2.id}`, A), H2.id);
    publicView('8 D GET H2', await call('GET', `/api/items/${H2.id}`, D), H2.id);
    const mb2 = await call('GET', '/api/me/items', B);
    check('8 B /me/items again -> 200', mb2.status === 200, short(mb2));
    const ma2 = await call('GET', '/api/me/items', A);
    check('8 A /me/items again -> 200', ma2.status === 200, short(ma2));

    // ---- 9. desk queue auth ----
    const q0 = await call('GET', '/api/desk/queue');
    check('9 desk queue no token -> 401', q0.status === 401, short(q0));
    const qb = await call('GET', '/api/desk/queue', B);
    check("9 desk queue as student B -> 403 'Desk staff only.'", qb.status === 403 && qb.body?.error === 'Desk staff only.', short(qb));

    // ---- 10. desk queue isolation: /api/found stamps desk items with the real DPS desk ----
    const inQueue = (q: Res, id: string) => [...arr(q.body?.en_route), ...arr(q.body?.at_desk)].some((i) => i?.id === id);
    const e1Row = await service.from('found_items').select('held_at_desk_id').eq('id', E1.id).maybeSingle();
    const stamped = e1Row.data?.held_at_desk_id ?? null;
    const q1 = await call('GET', '/api/desk/queue', D);
    check('10 D desk queue -> 200 keys en_route, at_desk, reviews, desk_id', q1.status === 200 && sameKeys(q1.body, ['at_desk', 'desk_id', 'en_route', 'reviews']), short(q1));
    check('10 finder-held H not in desk queue', !inQueue(q1, H.id), short(q1));
    if (stamped && stamped !== DESK) {
      check("10 E1 (another desk's) not in D's queue", !inQueue(q1, E1.id), short(q1));
      publicView("10 D GET E1 (another desk's) -> public", await call('GET', `/api/items/${E1.id}`, D), E1.id);
    } else {
      console.log(`NOTE: E1 held_at_desk_id was ${stamped}, so the other-desk isolation case isn't exercised (no DPS desk?)`);
    }
    const un = await service.from('found_items').update({ held_at_desk_id: null }).eq('id', E1.id);
    check('setup E1 held_at_desk_id = null', !un.error, un.error?.message);
    const q2 = await call('GET', '/api/desk/queue', D);
    const qE1 = arr(q2.body?.en_route).find((i) => i?.id === E1.id);
    check('10 E1 (unassigned) now in en_route', q2.status === 200 && qE1?.status === 'en_route_to_desk', short(q2));
    check('10 queue items keys == PublicFoundItem', [...arr(q2.body?.en_route), ...arr(q2.body?.at_desk)].every((i) => sameKeys(i, PUBLIC_KEYS)), JSON.stringify(qE1 && Object.keys(qE1)));
    leakCheck('10 D desk queue', q2, REVIEWER);
    privileged('10 D GET E1', await call('GET', `/api/items/${E1.id}`, D), E1.id, 'desk');

    // ---- 11. desk queue reviews ----
    const rv = await call('POST', `/api/items/${E2.code}/receive`, D);
    check('11 D receives E2 -> at_desk', rv.status === 200 && rv.body?.item?.status === 'at_desk' && rv.body?.item?.held_at_desk_id === DESK, short(rv));
    const dc = await call('POST', '/api/claims', A, { foundItemId: E2.id, lostReportId: reportA1 });
    const deskClaim: string = dc.body?.claimId ?? '';
    check("11 A claims E2 (A's 3rd claim today) -> 200", dc.status === 200 && !!deskClaim && questionsOk(dc.body?.questions), short(dc));
    const da = await call('POST', `/api/claims/${deskClaim}/answers`, A, answersFor(arr(dc.body?.questions), fullAnswer));
    check('11 A answers E2 -> 200', da.status === 200 && typeof da.body?.status === 'string', short(da));
    if (da.body?.status !== 'needs_review') {
      const f = await service.from('claims').update({ status: 'needs_review', pickup_code: null }).eq('id', deskClaim);
      console.log(`NOTE: forced needs_review via service key (got ${da.body?.status ?? da.status})`);
      check('11 setup force needs_review', !f.error, f.error?.message);
    }
    const q3 = await call('GET', '/api/desk/queue', D);
    check('11 D desk queue -> 200 keys en_route, at_desk, reviews, desk_id', q3.status === 200 && sameKeys(q3.body, ['at_desk', 'desk_id', 'en_route', 'reviews']), short(q3));
    check('11 E2 in at_desk', arr(q3.body?.at_desk).some((i) => i?.id === E2.id), short(q3));
    const rq = arr(q3.body?.reviews).find((c) => c?.id === deskClaim);
    check("11 reviews has A's E2 claim: desk view, answers, flags, 'Alice O.'",
      rq?.viewer === 'desk' && rq?.status === 'needs_review' && rq?.item?.id === E2.id && Array.isArray(rq?.answers) && Array.isArray(rq?.flags) && rq?.claimant_name === 'Alice O.',
      JSON.stringify(rq ?? null).slice(0, 200));
    check('11 review has no pickup_code, reviewer-lean keys, item keys == PublicFoundItem', rq?.pickup_code === undefined && keysWithin(rq, REVIEW_KEYS) && sameKeys(rq?.item, PUBLIC_KEYS), JSON.stringify(rq && Object.keys(rq)));
    check('11 reviews only needs_review', arr(q3.body?.reviews).every((c) => c?.status === 'needs_review'), short(q3));
    leakCheck('11 D desk queue with reviews', q3, [...REVIEWER, ['pickup code', heldCode]]);

    // Handler releasing their own passed claim: D handles E2 (at D's desk), so this reaches the self-release 403.
    const reportD = await insertReport('D lost report', ids.D ?? '');
    const dOwn = await service
      .from('claims')
      .insert({ found_item_id: E2.id, lost_report_id: reportD, claimant_id: ids.D, status: 'likely_owner', pickup_code: '246802', attempt_no: 1, questions: [], flags: [] })
      .select('id')
      .single();
    check("setup D's likely_owner claim on E2", !dOwn.error, dOwn.error?.message);
    const dSelf = await call('POST', `/api/items/${E2.id}/return`, D, { pickupCode: '246802' });
    check(`11 D (handler) returns with own pickup code -> 403 "You can't release your own claim."`, dSelf.status === 403 && dSelf.body?.error === "You can't release your own claim.", short(dSelf));
    const e2s = await service.from('found_items').select('status').eq('id', E2.id).maybeSingle();
    check('11 db E2 still at_desk', e2s.data?.status === 'at_desk', `${e2s.data?.status}`);
    const dcs = await service.from('claims').select('status').eq('id', dOwn.data?.id ?? '').maybeSingle();
    check("11 db D's claim still likely_owner", dcs.data?.status === 'likely_owner', `${dcs.data?.status}`);

    // ---- 12. privacy scan over every response ----
    const pii = seen.filter((s) => PII.some(([, b]) => s.res.text.includes(b))).map((s) => s.what);
    check(`12 no response (of ${seen.length}) contains photo paths or a test email`, pii.length === 0, pii.join(', '));
    const other = seen.filter((s) => s.res.text.includes(OTHER_CODE)).map((s) => s.what);
    check("12 C's pickup code in no response", other.length === 0, other.join(', '));
    const mine = seen.filter((s) => s.token !== A && heldCode && s.res.text.includes(heldCode)).map((s) => s.what);
    check("12 A's pickup code only in A's responses", mine.length === 0, mine.join(', '));
  } finally {
    // ---- 13. Cleanup: claims -> reports -> items + storage -> notifications -> auth users -> desk -> building ----
    await purge(service, created);
    await dropAuthUsers(service, created);
    const count = async (label: string, q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
      const r = await q;
      const n = r.error ? -1 : (r.count ?? 0);
      if (n !== 0) failed++;
      console.log(n === 0 ? `ok leftover ${label}: 0` : `FAIL leftover ${label}: ${r.error ? r.error.message : n}`);
    };
    const head = { count: 'exact' as const, head: true };
    if (created.length) {
      await count('claims', service.from('claims').select('id', head).in('claimant_id', created));
      await count('messages', service.from('messages').select('id', head).in('sender_id', created));
      await count('lost_reports', service.from('lost_reports').select('id', head).in('owner_id', created));
      await count('found_items', service.from('found_items').select('id', head).in('finder_id', created));
      await count('notifications (users)', service.from('notifications').select('id', head).in('user_id', created));
      await count('users', service.from('users').select('id', head).in('id', created));
    }
    await count('notifications (zz-test)', service.from('notifications').select('id', head).ilike('text', '%zz-test%'));
    await count('desks', service.from('desks').select('id', head).eq('id', DESK));
    await count('buildings', service.from('buildings').select('id', head).eq('id', BUILDING));
  }

  console.log(failed ? `${failed} checks failed` : 'E checks passed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('FAIL unexpected error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
