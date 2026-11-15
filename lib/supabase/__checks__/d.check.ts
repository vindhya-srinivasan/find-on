// Phase D claim/review/return check. Needs `npm run dev` up (or BASE_URL): npx tsx lib/supabase/__checks__/d.check.ts
/* eslint-disable @typescript-eslint/no-explicit-any -- probes untyped JSON responses on purpose */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';

let failed = 0;
function check(label: string, pass: boolean, detail?: string) {
  if (!pass) failed++;
  console.log(pass ? `ok ${label}` : `FAIL ${label}${detail ? `: ${detail}` : ''}`);
}

// Mirrors PublicFoundItem / Question / ChatMessage in types/index.ts (no app imports here on purpose).
const PUBLIC_KEYS = [
  'id', 'item_code', 'public_title', 'category', 'color', 'found_building_id', 'found_date',
  'blurred_thumb_url', 'status', 'return_method', 'held_at_desk_id',
].sort();
const QUESTION_KEYS = ['id', 'question', 'hint', 'detail_indexes'];
const MESSAGE_KEYS = ['id', 'mine', 'sender_name', 'body', 'created_at'].sort();
// Names contain zz-test so the notification cleanup (text ilike '%zz-test%') also catches real desk users' rows.
const BUILDING = 'zz-test-d';
const DESK = 'zz-test-desk'; // must not contain "dps": /api/found picks the DPS desk by name
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

type Res = { status: number; text: string; body: any };
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
  return { status: r.status, text, body: parsed };
}
const short = (r: Res) => `${r.status} ${r.text.slice(0, 200)}`;
const sameKeys = (o: any, keys: string[]) => !!o && typeof o === 'object' && JSON.stringify(Object.keys(o).sort()) === JSON.stringify(keys);
const keysWithin = (o: any, keys: string[]) => !!o && typeof o === 'object' && Object.keys(o).every((k) => keys.includes(k));

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
      C: { first_name: 'Cara', last_initial: 'X' }, // other claimant
      D: { first_name: 'Dana', last_initial: 'K' }, // desk staff
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
    // Never in any response before a claim passes (and never to someone who is not the verified claimant).
    const PRIVATE: [string, string][] = [
      ['detail 1', `HDA${rand}`], ['detail 2', `HDB${rand}`], ['detail 3', `HDC${rand}`],
      ['brand', secret.brand], ['landmark', secret.landmark], ['photo_paths', 'photo_paths'],
      ['hidden_details', 'hidden_details'], ['blurred_thumb_path', 'blurred_thumb_path'], ['finder_id', 'finder_id'],
      ...emailBan,
    ];
    // Never in any response, to anyone.
    const PII: [string, string][] = [['photo_paths', 'photo_paths'], ['blurred_thumb_path', 'blurred_thumb_path'], ...emailBan];
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
    const lostForm = () => {
      const fd = new FormData();
      const fields = { text: 'Grey water bottle, lost today zz-test', buildingIds: JSON.stringify([BUILDING]), notSure: 'false', landmarks: '[]' };
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

    // ---- 1. no token / bad input ----
    const someId = randomUUID();
    check('1 POST /api/claims without token -> 401', (await call('POST', '/api/claims', undefined, { foundItemId: someId, lostReportId: someId })).status === 401);
    check('1 GET claim without token -> 401', (await call('GET', `/api/claims/${someId}`)).status === 401);
    check('1 POST return without token -> 401', (await call('POST', `/api/items/${someId}/return`, undefined, { pickupCode: '123456' })).status === 401);
    const bj = await call('POST', '/api/claims', A, 'not json');
    check('1 POST /api/claims bad JSON -> 400', bj.status === 400, short(bj));
    const bz = await call('POST', '/api/claims', A, { foundItemId: 'nope', lostReportId: someId });
    check('1 POST /api/claims bad uuid body -> 400', bz.status === 400, short(bz));
    const bu = await call('GET', '/api/claims/not-a-uuid', A);
    check('1 GET /api/claims/not-a-uuid -> 404', bu.status === 404, short(bu));
    const nf = await call('POST', '/api/claims', A, { foundItemId: someId, lostReportId: someId });
    check('1 claim unknown item -> 404', nf.status === 404, short(nf));

    // ---- 2. held path: A files FIRST, then B posts a held item with 2 details (one weight 3) ----
    const lr = await call('POST', '/api/lost', A, lostForm());
    const reportA1: string = lr.body?.reportId ?? '';
    check('2 A files lost report -> 200', lr.status === 200 && !!reportA1, short(lr));
    const held = await postItem('2', [{ detail: secret.d1, weight: 3 }, { detail: secret.d2, weight: 2 }], 'finder');

    const own = await call('POST', '/api/claims', B, { foundItemId: held.id, lostReportId: reportA1 });
    check('2 finder claims own item -> 403', own.status === 403, short(own));

    const cl = await call('POST', '/api/claims', A, { foundItemId: held.id, lostReportId: reportA1 });
    const heldClaim: string = cl.body?.claimId ?? '';
    const heldQs: any[] = Array.isArray(cl.body?.questions) ? cl.body.questions : [];
    check('2 A claims -> 200 { claimId, questions }', cl.status === 200 && !!heldClaim && sameKeys(cl.body, ['claimId', 'questions']), short(cl));
    check('2 questions shape (1-3, id/question/hint?/detail_indexes only)', questionsOk(cl.body?.questions), JSON.stringify(heldQs).slice(0, 200));
    leakCheck('2 claim response', cl, [...PRIVATE, ['finder id', ids.B]]);
    const again = await call('POST', '/api/claims', A, { foundItemId: held.id, lostReportId: reportA1 });
    check('2 repeat claim while awaiting -> 200 same claimId', again.status === 200 && again.body?.claimId === heldClaim, short(again));

    const g0 = await call('GET', `/api/claims/${heldClaim}`, A);
    check('2 A GET claim -> claimant, awaiting_answers, questions', g0.status === 200 && g0.body?.viewer === 'claimant' && g0.body?.status === 'awaiting_answers' && Array.isArray(g0.body?.questions), short(g0));
    check('2 A GET claim before pass hides code/score/reason/flags/answers/photos',
      ['pickup_code', 'score', 'reason', 'flags', 'answers', 'full_photo_urls'].every((k) => g0.body?.[k] === undefined), short(g0));
    check('2 A GET claim item keys == PublicFoundItem', sameKeys(g0.body?.item, PUBLIC_KEYS), JSON.stringify(g0.body?.item && Object.keys(g0.body.item)));
    leakCheck('2 A GET claim before pass', g0, [...PRIVATE, ['finder id', ids.B]]);
    const gb0 = await call('GET', `/api/claims/${heldClaim}`, B);
    check('2 B (finder) GET before pass -> no claimant_name', gb0.status === 200 && gb0.body?.viewer === 'finder' && gb0.body?.claimant_name === undefined, short(gb0));

    const m0a = await call('GET', `/api/claims/${heldClaim}/messages`, A);
    check('2 A messages before pass -> 409', m0a.status === 409, short(m0a));
    const m0b = await call('POST', `/api/claims/${heldClaim}/messages`, B, { body: 'hello zz-test' });
    check('2 B post message before pass -> 409', m0b.status === 409, short(m0b));

    const bad = await call('POST', `/api/claims/${heldClaim}/answers`, A, { answers: [...answersFor(heldQs, 'x').answers, { question_id: 'zz-extra', answer: 'x' }] });
    check('2 answers not one per question -> 400', bad.status === 400, short(bad));

    const an = await call('POST', `/api/claims/${heldClaim}/answers`, A, answersFor(heldQs, fullAnswer));
    let heldCode: string = an.body?.pickupCode ?? '';
    const naturalPass = an.status === 200 && an.body?.status === 'likely_owner';
    check('2 A answers -> 200', an.status === 200 && typeof an.body?.status === 'string', short(an));
    if (naturalPass) {
      check('2 likely_owner -> { status, pickupCode } 6 digits', sameKeys(an.body, ['pickupCode', 'status']) && /^\d{6}$/.test(heldCode), short(an));
    } else {
      check('2 non-passing answer has no pickupCode', an.body?.pickupCode === undefined, short(an));
      heldCode = String(randomInt(0, 1000000)).padStart(6, '0');
      const f = await service.from('claims').update({ status: 'likely_owner', pickup_code: heldCode }).eq('id', heldClaim);
      console.log(`NOTE: forced likely_owner via service key (got ${an.body?.status ?? an.status})`);
      check('2 setup force likely_owner', !f.error, f.error?.message);
    }
    const dbl = await call('POST', `/api/claims/${heldClaim}/answers`, A, answersFor(heldQs, fullAnswer));
    check('2 double submit answers -> 409', dbl.status === 409, short(dbl));

    // ---- 3. held path after pass ----
    const g1 = await call('GET', `/api/claims/${heldClaim}`, A);
    check('3 A GET claim after pass -> own pickup_code', g1.status === 200 && g1.body?.pickup_code === heldCode, short(g1));
    check('3 A full_photo_urls signed', Array.isArray(g1.body?.full_photo_urls) && g1.body.full_photo_urls.length > 0 && g1.body.full_photo_urls.every((u: any) => typeof u === 'string' && u.includes('token=')), JSON.stringify(g1.body?.full_photo_urls)?.slice(0, 120));
    const rd = g1.body?.return_details;
    check('3 A return_details finder "Bob F." + availability', rd?.method === 'finder' && rd?.finder_name === 'Bob F.' && rd?.finder_availability === 'weekdays 2-4pm', JSON.stringify(rd));
    check('3 A sees no score/reason/flags', ['score', 'reason', 'flags'].every((k) => g1.body?.[k] === undefined), short(g1));
    leakCheck('3 A GET claim after pass', g1, [...PII, ['finder id', ids.B]]);

    const gb = await call('GET', `/api/claims/${heldClaim}`, B);
    check('3 B GET claim -> finder view with answers', gb.status === 200 && gb.body?.viewer === 'finder' && Array.isArray(gb.body?.answers), short(gb));
    check('3 B sees claimant_name "Alice O." after pass', gb.body?.claimant_name === 'Alice O.', `${gb.body?.claimant_name}`);
    check('3 B never sees pickup code', gb.body?.pickup_code === undefined && !gb.text.includes(heldCode), short(gb));
    leakCheck('3 B GET claim', gb, [...PII, ['claimant id', aId]]);

    const gc = await call('GET', `/api/claims/${heldClaim}`, C);
    check('3 C GET claim -> 404', gc.status === 404, short(gc));
    leakCheck('3 C GET claim', gc, [...PRIVATE, ['pickup code', heldCode]]);
    const mc = await call('GET', `/api/claims/${heldClaim}/messages`, C);
    check('3 C GET messages -> 404', mc.status === 404, short(mc));

    if (naturalPass) {
      const nb = await call('GET', '/api/notifications', B);
      check('3 B notified chat is open', nb.status === 200 && Array.isArray(nb.body) && nb.body.some((n: any) => n?.link === `/claims/${heldClaim}`), short(nb));
      leakCheck('3 B notifications', nb, [...PRIVATE, ['pickup code', heldCode]]);
    }

    const ma = await call('POST', `/api/claims/${heldClaim}/messages`, A, { body: '  hi from owner zz-test  ' });
    const la: any[] = Array.isArray(ma.body) ? ma.body : [];
    check('3 A posts message -> full list', ma.status === 200 && la.length === 1 && la[0]?.mine === true && la[0]?.body === 'hi from owner zz-test' && la[0]?.sender_name === 'Alice O.', short(ma));
    const mb = await call('POST', `/api/claims/${heldClaim}/messages`, B, { body: 'hi from finder' });
    const lb: any[] = Array.isArray(mb.body) ? mb.body : [];
    check('3 B posts message -> 2 oldest first', mb.status === 200 && lb.length === 2 && lb[0]?.mine === false && lb[1]?.mine === true && lb[1]?.sender_name === 'Bob F.', short(mb));
    check('3 message keys exact', lb.length > 0 && lb.every((m) => sameKeys(m, MESSAGE_KEYS)), JSON.stringify(lb[0] && Object.keys(lb[0])));
    leakCheck('3 messages', mb, [...PII, ['claimant id', aId], ['finder id', ids.B], ['sender_id', 'sender_id']]);
    const me = await call('POST', `/api/claims/${heldClaim}/messages`, A, { body: '   ' });
    check('3 blank message -> 400', me.status === 400, short(me));

    // C's competing open claim + report (service-inserted, backdated so later two-pass has no filed_after_listing flag).
    const reportC1 = await insertReport('C lost report', cId, hourAgo);
    const ccl = await service
      .from('claims')
      .insert({ found_item_id: held.id, lost_report_id: reportC1, claimant_id: cId, status: 'needs_review', attempt_no: 1 })
      .select('id')
      .single();
    check('setup C competing claim', !ccl.error, ccl.error?.message);
    const cClaim = String(ccl.data?.id ?? '');

    const wrong = String((Number(heldCode) + 1) % 1000000).padStart(6, '0');
    const rw = await call('POST', `/api/items/${held.id}/return`, B, { pickupCode: wrong });
    check('3 return wrong code -> 400', rw.status === 400 && rw.body?.error === "That code doesn't match.", short(rw));
    const rc = await call('POST', `/api/items/${held.id}/return`, C, { pickupCode: heldCode });
    check('3 return by non-handler -> 404', rc.status === 404, short(rc));
    const rr = await call('POST', `/api/items/${held.id}/return`, B, { pickupCode: heldCode });
    check('3 return right code -> 200 returned', rr.status === 200 && sameKeys(rr.body, ['status']) && rr.body.status === 'returned', short(rr));

    const hi = await service.from('found_items').select('status').eq('id', held.id).maybeSingle();
    check('3 db item returned', hi.data?.status === 'returned', `${hi.data?.status}`);
    const hc = await service.from('claims').select('status').eq('id', heldClaim).maybeSingle();
    check('3 db A claim returned', hc.data?.status === 'returned', `${hc.data?.status}`);
    const ha = await service.from('lost_reports').select('status').eq('id', reportA1).maybeSingle();
    check("3 db A's report resolved", ha.data?.status === 'resolved', `${ha.data?.status}`);
    const hcc = await service.from('claims').select('status, pickup_code').eq('id', cClaim).maybeSingle();
    check("3 db C's claim rejected, code null", hcc.data?.status === 'rejected' && hcc.data?.pickup_code === null, JSON.stringify(hcc.data));
    const hcr = await service.from('lost_reports').select('status').eq('id', reportC1).maybeSingle();
    check("3 db C's report still open", hcr.data?.status === 'open', `${hcr.data?.status}`);
    const r2 = await call('POST', `/api/items/${held.id}/return`, B, { pickupCode: heldCode });
    check('3 second return -> 409', r2.status === 409, short(r2));

    // ---- 4. return-method: held -> desk ----
    const rm = await postItem('4', [{ detail: secret.d1, weight: 3 }, { detail: secret.d2, weight: 2 }], 'finder');
    const rmA = await call('POST', `/api/items/${rm.id}/return-method`, A, { returnMethod: 'desk' });
    check('4 return-method by non-finder -> 404', rmA.status === 404, short(rmA));
    const rmB = await call('POST', `/api/items/${rm.id}/return-method`, B, { returnMethod: 'desk' });
    check('4 return-method -> 200 en_route_to_desk', rmB.status === 200 && rmB.body?.item?.status === 'en_route_to_desk' && rmB.body?.item?.return_method === 'desk', short(rmB));
    check('4 return-method item keys == PublicFoundItem', sameKeys(rmB.body?.item, PUBLIC_KEYS), JSON.stringify(rmB.body?.item && Object.keys(rmB.body.item)));
    leakCheck('4 return-method response', rmB, PRIVATE);
    const rmRow = await service.from('found_items').select('finder_availability').eq('id', rm.id).maybeSingle();
    check('4 db finder_availability cleared', rmRow.data?.finder_availability === null, `${rmRow.data?.finder_availability}`);
    const rm2 = await call('POST', `/api/items/${rm.id}/return-method`, B, { returnMethod: 'desk' });
    check('4 second return-method -> 409', rm2.status === 409, short(rm2));

    // ---- 5. desk path: 1 detail -> low_verifiability -> needs_review ----
    const desk = await postItem('5', [{ detail: secret.d3, weight: 3 }], 'desk');
    const rb = await call('POST', `/api/items/${desk.code}/receive`, B);
    check('5 receive by student -> 403', rb.status === 403 && rb.body?.error === 'Desk staff only.', short(rb));
    const rx = await call('POST', '/api/items/FO-NOPE/receive', D);
    check('5 receive bad code -> 404', rx.status === 404, short(rx));
    const rv = await call('POST', `/api/items/${desk.code.toLowerCase()}/receive`, D);
    check('5 desk receives lowercase code -> 200 at_desk', rv.status === 200 && rv.body?.item?.status === 'at_desk' && rv.body?.item?.held_at_desk_id === DESK, short(rv));
    check('5 receive item keys == PublicFoundItem', sameKeys(rv.body?.item, PUBLIC_KEYS), JSON.stringify(rv.body?.item && Object.keys(rv.body.item)));
    leakCheck('5 receive response', rv, PRIVATE);
    const rv2 = await call('POST', `/api/items/${desk.code}/receive`, D);
    check('5 second receive -> 409', rv2.status === 409, short(rv2));

    const reportA2 = await insertReport('A second report', aId);
    const dc = await call('POST', '/api/claims', A, { foundItemId: desk.id, lostReportId: reportA2 });
    const deskClaim: string = dc.body?.claimId ?? '';
    check('5 A claims desk item -> 200', dc.status === 200 && !!deskClaim && questionsOk(dc.body?.questions), short(dc));
    leakCheck('5 desk claim response', dc, PRIVATE);
    const da = await call('POST', `/api/claims/${deskClaim}/answers`, A, answersFor(dc.body?.questions ?? [], fullAnswer));
    check('5 low_verifiability -> needs_review, no code', da.status === 200 && sameKeys(da.body, ['status']) && da.body.status === 'needs_review', short(da));
    leakCheck('5 answers response', da, PRIVATE);
    const dcf = await service.from('claims').select('flags').eq('id', deskClaim).maybeSingle();
    check('5 db flags include low_verifiability', Array.isArray(dcf.data?.flags) && dcf.data.flags.includes('low_verifiability'), JSON.stringify(dcf.data));

    const gA = await call('GET', `/api/claims/${deskClaim}`, A);
    check('5 A GET needs_review claim: no code/photos', gA.status === 200 && gA.body?.status === 'needs_review' && gA.body?.pickup_code === undefined && gA.body?.full_photo_urls === undefined, short(gA));
    leakCheck('5 A GET claim before pass', gA, PRIVATE);
    const gD = await call('GET', `/api/claims/${deskClaim}`, D);
    check('5 desk GET claim -> desk view', gD.status === 200 && gD.body?.viewer === 'desk' && Array.isArray(gD.body?.answers) && Array.isArray(gD.body?.flags) && gD.body.flags.includes('low_verifiability'), short(gD));
    check('5 desk sees claimant_name "Alice O."', gD.body?.claimant_name === 'Alice O.', `${gD.body?.claimant_name}`);
    check('5 desk sees no pickup code', gD.body?.pickup_code === undefined, short(gD));
    leakCheck('5 desk GET claim', gD, [...PII, ['claimant id', aId]]);
    const gB = await call('GET', `/api/claims/${deskClaim}`, B);
    check('5 finder of desk item GET claim -> 404', gB.status === 404, short(gB));
    leakCheck('5 finder GET desk claim', gB, PRIVATE);
    const nD = await call('GET', '/api/notifications', D);
    check('5 desk notified for review', nD.status === 200 && Array.isArray(nD.body) && nD.body.some((n: any) => n?.link === `/claims/${deskClaim}`), short(nD));
    leakCheck('5 desk notifications', nD, PRIVATE);

    const vB = await call('POST', `/api/claims/${deskClaim}/review`, B, { decision: 'approve' });
    check('5 review by finder of desk item -> 404', vB.status === 404, short(vB));
    const vA = await call('POST', `/api/claims/${deskClaim}/review`, A, { decision: 'approve' });
    check('5 review by claimant -> 404', vA.status === 404, short(vA));
    const vx = await call('POST', `/api/claims/${deskClaim}/review`, D, { decision: 'maybe' });
    check('5 review bad decision -> 400', vx.status === 400, short(vx));
    const vD = await call('POST', `/api/claims/${deskClaim}/review`, D, { decision: 'approve' });
    check('5 desk approves -> 200 approved', vD.status === 200 && sameKeys(vD.body, ['status']) && vD.body.status === 'approved', short(vD));
    const vD2 = await call('POST', `/api/claims/${deskClaim}/review`, D, { decision: 'approve' });
    check('5 second review -> 409', vD2.status === 409, short(vD2));

    const gA2 = await call('GET', `/api/claims/${deskClaim}`, A);
    const deskCode: string = gA2.body?.pickup_code ?? '';
    check('5 A GET approved claim -> pickup_code', gA2.status === 200 && gA2.body?.status === 'approved' && /^\d{6}$/.test(deskCode), short(gA2));
    const drd = gA2.body?.return_details;
    check('5 A return_details desk name + hours', drd?.method === 'desk' && drd?.desk_name === DESK && drd?.desk_hours === 'Mon-Fri 9-5', JSON.stringify(drd));
    leakCheck('5 A GET approved claim', gA2, PII);
    const nA = await call('GET', '/api/notifications', A);
    check('5 A notified of review decision', nA.status === 200 && Array.isArray(nA.body) && nA.body.some((n: any) => n?.link === `/claims/${deskClaim}`), short(nA));
    const mD = await call('GET', `/api/claims/${deskClaim}/messages`, A);
    check('5 messages on desk item -> 404', mD.status === 404, short(mD));

    const dw = await call('POST', `/api/items/${desk.id}/return`, D, { pickupCode: String((Number(deskCode) + 1) % 1000000).padStart(6, '0') });
    check('5 desk return wrong code -> 400', dw.status === 400, short(dw));
    const dr = await call('POST', `/api/items/${desk.id}/return`, D, { pickupCode: deskCode });
    check('5 desk return right code -> 200 returned', dr.status === 200 && dr.body?.status === 'returned', short(dr));
    const di = await service.from('found_items').select('status').eq('id', desk.id).maybeSingle();
    check('5 db desk item returned', di.data?.status === 'returned', `${di.data?.status}`);
    const dcl = await service.from('claims').select('status').eq('id', deskClaim).maybeSingle();
    check('5 db desk claim returned', dcl.data?.status === 'returned', `${dcl.data?.status}`);
    const dlr = await service.from('lost_reports').select('status').eq('id', reportA2).maybeSingle();
    check('5 db A second report resolved', dlr.data?.status === 'resolved', `${dlr.data?.status}`);

    // ---- 6. limits: A has 2 claims in 24 h so far; a rejected filler makes 3 ----
    const reportA3 = await insertReport('A third report', aId);
    const x = await postItem('6 X', [{ detail: secret.d1, weight: 3 }, { detail: secret.d2, weight: 2 }], 'desk');
    const y = await postItem('6 Y', [{ detail: secret.d1, weight: 3 }, { detail: secret.d2, weight: 2 }], 'desk');
    const fil = await service
      .from('claims')
      .insert({ found_item_id: x.id, lost_report_id: reportA3, claimant_id: aId, status: 'rejected', attempt_no: 1 })
      .select('id')
      .single();
    check('setup rejected filler claim', !fil.error, fil.error?.message);
    const gR = await call('GET', `/api/claims/${fil.data?.id}`, A);
    check('6 rejected attempt 1 -> retry_after set', gR.status === 200 && gR.body?.status === 'rejected' && typeof gR.body?.retry_after === 'string', short(gR));
    check('6 rejected claim hides score/reason', gR.body?.score === undefined && gR.body?.reason === undefined, short(gR));
    const re = await call('POST', '/api/claims', A, { foundItemId: x.id, lostReportId: reportA3 });
    check('6 re-claim before 24 h -> 409', re.status === 409, short(re));
    const noRep = await call('POST', '/api/claims', A, { foundItemId: y.id, lostReportId: reportC1 });
    check("6 claim with someone else's report -> 400", noRep.status === 400, short(noRep));
    const cap = await call('POST', '/api/claims', A, { foundItemId: y.id, lostReportId: reportA3 });
    check('6 4th claim in 24 h -> 429', cap.status === 429, short(cap));

    // ---- 7. two-pass: backdated likely_owner claim by A exists; C passes too -> both needs_review ----
    const t = await postItem('7', [{ detail: secret.d1, weight: 3 }, { detail: secret.d2, weight: 2 }], 'finder');
    const prior = await service
      .from('claims')
      .insert({ found_item_id: t.id, lost_report_id: reportA3, claimant_id: aId, status: 'likely_owner', pickup_code: '246810', attempt_no: 1, created_at: hourAgo })
      .select('id')
      .single();
    check('setup prior likely_owner claim', !prior.error, prior.error?.message);
    const tc = await call('POST', '/api/claims', C, { foundItemId: t.id, lostReportId: reportC1 });
    const tClaim: string = tc.body?.claimId ?? '';
    check('7 C claims -> 200', tc.status === 200 && !!tClaim, short(tc));
    leakCheck('7 C claim response', tc, [...PRIVATE, ['other pickup code', '246810']]);
    const ta = await call('POST', `/api/claims/${tClaim}/answers`, C, answersFor(tc.body?.questions ?? [], fullAnswer));
    leakCheck('7 C answers response', ta, [...PRIVATE, ['other pickup code', '246810']]);
    if (ta.status === 200 && ta.body?.status !== 'needs_review' && ta.body?.status !== 'likely_owner') {
      // Real grading didn't pass C, so the two-pass rule never fired; nothing to assert.
      console.log(`NOTE: skipped two-pass asserts, C's answers graded ${ta.body?.status}`);
    } else {
      check('7 C answers -> needs_review, no code', ta.status === 200 && sameKeys(ta.body, ['status']) && ta.body.status === 'needs_review', short(ta));
      const both = await service.from('claims').select('id, status, pickup_code').eq('found_item_id', t.id);
      check('7 db both claims needs_review, codes null',
        !both.error && (both.data?.length ?? 0) === 2 && both.data!.every((c) => c.status === 'needs_review' && c.pickup_code === null), JSON.stringify(both.data));
    }
    const tg = await call('GET', `/api/claims/${tClaim}`, C);
    leakCheck('7 C GET claim', tg, [...PRIVATE, ['other pickup code', '246810']]);

    // ---- 8. flagged claim with wrong answers -> needs_review, never rejected (spec: human decides whatever the score) ----
    const fItem = await postItem('8', [{ detail: secret.d2, weight: 3 }], 'finder');
    const fc = await call('POST', '/api/claims', C, { foundItemId: fItem.id, lostReportId: reportC1 });
    const fClaim: string = fc.body?.claimId ?? '';
    check('8 C claims flagged item -> 200', fc.status === 200 && !!fClaim, short(fc));
    const fa = await call('POST', `/api/claims/${fClaim}/answers`, C, answersFor(fc.body?.questions ?? [], 'no idea'));
    check('8 flagged + wrong answers -> needs_review, no code', fa.status === 200 && sameKeys(fa.body, ['status']) && fa.body.status === 'needs_review', short(fa));
    const fdb = await service.from('claims').select('status, score, flags, pickup_code').eq('id', fClaim).maybeSingle();
    check('8 db needs_review, low_verifiability, no code',
      fdb.data?.status === 'needs_review' && fdb.data?.pickup_code === null && Array.isArray(fdb.data?.flags) && fdb.data.flags.includes('low_verifiability'), JSON.stringify(fdb.data));
    if (typeof fdb.data?.score === 'number' && fdb.data.score < 40) console.log(`ok 8 under-40 path exercised (score ${fdb.data.score})`);
    else console.log(`NOTE: 8 score was ${fdb.data?.score}, so the under-40 path isn't exercised until P3's real grading lands`);
  } finally {
    // ---- Cleanup: claims -> reports -> items + storage -> notifications -> auth users -> desk -> building ----
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

  console.log(failed ? `${failed} checks failed` : 'D checks passed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('FAIL unexpected error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
