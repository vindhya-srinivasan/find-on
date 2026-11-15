// Phase F check (reports + auto-flag, desk-logged items, claim proof photo, sweep + nudges). Needs `npm run dev` up (or BASE_URL): npx tsx lib/supabase/__checks__/f.check.ts
/* eslint-disable @typescript-eslint/no-explicit-any -- probes untyped JSON responses on purpose */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';

let failed = 0;
function check(label: string, pass: boolean, detail?: string) {
  if (!pass) failed++;
  console.log(pass ? `ok ${label}` : `FAIL ${label}${detail ? `: ${detail}` : ''}`);
}

// Names contain zz-test so the notification cleanup (text ilike '%zz-test%') also catches real desk users' rows.
const BUILDING = 'zz-test-f';
const DESK = 'zz-test-desk-f'; // must not contain "dps": /api/found picks the DPS desk by name
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const DAY = 24 * 60 * 60 * 1000;
const PAUSED = 'Your account is paused pending review.';

type Res = { status: number; text: string; body: any };
// Every response, for the final privacy scan.
const seen: { what: string; res: Res }[] = [];
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
  seen.push({ what: `${method} ${path}`, res });
  return res;
}
const short = (r: Res) => `${r.status} ${r.text.slice(0, 200)}`;
const sameKeys = (o: any, keys: string[]) => !!o && typeof o === 'object' && JSON.stringify(Object.keys(o).sort()) === JSON.stringify([...keys].sort());
const arr = (x: any): any[] => (Array.isArray(x) ? x : []);
const signed = (u: any) => typeof u === 'string' && u.includes('token=');
const errIs = (r: Res, status: number, msg?: string) => r.status === status && (msg === undefined || r.body?.error === msg);

// Each step independent so one failure doesn't strand the rest.
// FK order: abuse_reports (no cascade on reporter_id), claims (messages cascade), reports, items, notifications.
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
    const msgs = await service.from('messages').select('id').in('sender_id', userIds);
    const msgIds = (msgs.data ?? []).map((r) => r.id);
    await step('abuse_reports (reporters)', async () => ok(await service.from('abuse_reports').delete().in('reporter_id', userIds)));
    await step('abuse_reports (targets)', async () => ok(await service.from('abuse_reports').delete().in('target_id', [...userIds, ...itemIds, ...msgIds])));
    // select('*'): works before and after 0002 adds proof_photo_path.
    const cl = await service.from('claims').select('*').in('claimant_id', userIds);
    const lr = await service.from('lost_reports').select('owner_photo_path').in('owner_id', userIds);
    const extra = [...(cl.data ?? []).map((r: any) => r.proof_photo_path), ...(lr.data ?? []).map((r) => r.owner_photo_path)].filter(Boolean);
    if (extra.length) await step('proof + lost photos', async () => ok(await service.storage.from('photos').remove(extra)));
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
  const storagePaths: string[] = []; // proof + lost photos this run created
  const emails: Record<string, string> = {};
  const rand = randomBytes(4).toString('hex');
  const REASON = `RSN${rand} zz-test report`; // stored only, never echoed

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

    const people = {
      R1: { first_name: 'Rita', last_initial: 'A' }, // reporters
      R2: { first_name: 'Rob', last_initial: 'B' }, // also finder of the proof item
      R3: { first_name: 'Ravi', last_initial: 'C' },
      T: { first_name: 'Tom', last_initial: 'D' }, // report target + finder
      A: { first_name: 'Alice', last_initial: 'O' }, // claimant
      D: { first_name: 'Dana', last_initial: 'K' }, // desk staff of DESK
      F: { first_name: 'Finn', last_initial: 'S' }, // sweep finder
    };
    const tokens: Record<string, string> = {};
    const ids: Record<string, string> = {};
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
    if (Object.keys(people).some((k) => !tokens[k])) throw new Error('setup failed: no tokens');
    const { R1, R2, R3, T, A, D, F } = tokens;
    // First API call creates the students' users rows.
    for (const k of Object.keys(people)) {
      const n = await call('GET', '/api/notifications', tokens[k]);
      check(`setup ${k} first call -> 200`, n.status === 200, short(n));
    }

    const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 90, g: 90, b: 140 } } }).jpeg().toBuffer();
    const jpegFile = (name: string) => new File([new Uint8Array(jpeg)], name, { type: 'image/jpeg' });
    const postItem = async (label: string, token: string, returnMethod: 'desk' | 'finder') => {
      const fd = new FormData();
      fd.append('photos', jpegFile('item.jpg'));
      fd.append('buildingId', BUILDING);
      fd.append('landmark', `LMK${rand}`);
      fd.append('foundAt', new Date().toISOString());
      fd.append('analysis', JSON.stringify({
        is_valid_item: true, reject_reason: null, category: 'water bottle', color: 'grey', brand: `ZBR${rand}`,
        public_title: 'Grey water bottle', verifiability: 'high', is_valuable: false,
        hidden_details: [{ detail: `HDA${rand} sticker`, weight: 3 }, { detail: `HDB${rand} dent`, weight: 2 }],
      }));
      fd.append('returnMethod', returnMethod);
      if (returnMethod === 'finder') fd.append('availability', 'weekdays 2-4pm');
      const r = await call('POST', '/api/found', token, fd);
      check(`${label} -> 200`, r.status === 200 && !!r.body?.item?.id, short(r));
      return { id: String(r.body?.item?.id ?? ''), code: String(r.body?.item?.item_code ?? ''), res: r };
    };
    const itemRow = async (id: string) =>
      (await service.from('found_items').select('status, held_at_desk_id').eq('id', id).maybeSingle()).data;

    // ---- 1. Desk-logged items ----
    const DI = await postItem('1 D (desk staff) posts returnMethod desk', D, 'desk');
    check('1 D response item at_desk at own desk', DI.res.body?.item?.status === 'at_desk' && DI.res.body?.item?.held_at_desk_id === DESK, short(DI.res));
    const diRow = await itemRow(DI.id);
    check(`1 db D's item at_desk, held_at_desk_id ${DESK}`, diRow?.status === 'at_desk' && diRow?.held_at_desk_id === DESK, JSON.stringify(diRow));
    const TI = await postItem('1 T (student) posts returnMethod desk', T, 'desk');
    const tiRow = await itemRow(TI.id);
    check("1 db student's desk item en_route_to_desk", tiRow?.status === 'en_route_to_desk', JSON.stringify(tiRow));

    // ---- 2. More items (all posted before A's lost report exists, so matching makes no AI calls for them) ----
    const P = await postItem('2 R2 posts held item P', R2, 'finder');
    const U1 = await postItem('2 F posts U1 (31 d, no claims)', F, 'finder');
    const U2 = await postItem('2 F posts U2 (31 d, likely_owner claim)', F, 'finder');
    const N1 = await postItem('2 F posts N1 (4 d with_finder)', F, 'finder');
    const N2 = await postItem('2 F posts N2 (3 d en_route_to_desk)', F, 'desk');
    const FR = await postItem('2 F posts FR (fresh)', F, 'finder');
    for (const [label, it, days] of [['U1', U1, 31], ['U2', U2, 31], ['N1', N1, 4], ['N2', N2, 3]] as const) {
      const u = await service.from('found_items').update({ created_at: new Date(Date.now() - days * DAY).toISOString() }).eq('id', it.id);
      check(`setup backdate ${label} ${days} d`, !u.error, u.error?.message);
    }

    // A's lost report with an owner photo (service key: no AI parse needed).
    const reportA = randomUUID();
    const lostPath = `lost/${reportA}/photo.jpg`;
    const up = await service.storage.from('photos').upload(lostPath, jpeg, { contentType: 'image/jpeg', upsert: true });
    check('setup upload owner photo', !up.error, up.error?.message);
    storagePaths.push(lostPath);
    const now = new Date().toISOString();
    const lr = await service.from('lost_reports').insert({
      id: reportA, owner_id: ids.A, raw_text: 'zz-test grey water bottle', category: 'water bottle', color: 'grey',
      building_ids: [BUILDING], time_start: now, time_end: now, owner_photo_path: lostPath,
      created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    check('setup A lost report', !lr.error, lr.error?.message);
    const u2c = await service.from('claims').insert({
      found_item_id: U2.id, lost_report_id: reportA, claimant_id: ids.A, status: 'likely_owner',
      pickup_code: String(randomInt(0, 1000000)).padStart(6, '0'), attempt_no: 1, questions: [], flags: [],
    });
    check("setup A's likely_owner claim on U2 (A's claim 1 of 3 today)", !u2c.error, u2c.error?.message);
    // Service insert (bypasses the 3/day limit): an abandoned claim on U1 must not block or outlive the unclaimed sweep.
    const u1c = await service.from('claims').insert({
      found_item_id: U1.id, lost_report_id: reportA, claimant_id: ids.A, status: 'awaiting_answers', attempt_no: 1, questions: [], flags: [],
    }).select('id').single();
    check("setup A's awaiting_answers claim on U1", !u1c.error, u1c.error?.message);

    // ---- 3. Claim proof photo ----
    const cl = await call('POST', '/api/claims', A, { foundItemId: P.id, lostReportId: reportA });
    const claimId: string = cl.body?.claimId ?? '';
    const qs = arr(cl.body?.questions);
    check("3 A claims P (A's claim 2 of 3) -> 200", cl.status === 200 && !!claimId && qs.length > 0, short(cl));
    storagePaths.push(`claims/${claimId}/proof.jpg`);
    const proof = (token: string, file: File, id = claimId) => {
      const fd = new FormData();
      fd.append('photo', file);
      return call('POST', `/api/claims/${id}/proof`, token, fd);
    };
    const claimRow = async () => (await service.from('claims').select('*').eq('id', claimId).maybeSingle()).data as any;

    const probe = await service.from('claims').select('proof_photo_path').limit(1);
    if (probe.error) {
      const r = await proof(A, jpegFile('proof.jpg'));
      check("3 proof without 0002 -> 503 'Proof upload not available yet'", errIs(r, 503, 'Proof upload not available yet'), short(r));
      check('3 db claim still awaiting_answers', (await claimRow())?.status === 'awaiting_answers');
      console.log('NOTE: claims.proof_photo_path missing (run 0002_claim_proof.sql); rest of the proof block skipped');
    } else {
      const nc = await proof(R1, jpegFile('proof.jpg'));
      check("3 non-claimant proof -> 404 'Claim not found'", errIs(nc, 404, 'Claim not found'), short(nc));
      const bad = await proof(A, jpegFile('proof.jpg'), 'not-a-uuid');
      check("3 proof on bad id -> 404 'Claim not found'", errIs(bad, 404, 'Claim not found'), short(bad));
      const txt = await proof(A, new File(['not an image'], 'proof.txt', { type: 'text/plain' }));
      check('3 non-image proof -> 400', errIs(txt, 400), short(txt));
      const junk = await proof(A, new File(['not a jpeg'], 'proof.jpg', { type: 'image/jpeg' }));
      check("3 unreadable jpeg -> 400 'photo: could not read image'", errIs(junk, 400, 'photo: could not read image'), short(junk));
      check('3 db claim still awaiting_answers after bad uploads', (await claimRow())?.status === 'awaiting_answers');

      const ok1 = await proof(A, jpegFile('proof.jpg'));
      check("3 A proof -> 200 { status: 'needs_review' }", ok1.status === 200 && sameKeys(ok1.body, ['status']) && ok1.body?.status === 'needs_review', short(ok1));
      const row = await claimRow();
      check('3 db claim needs_review, proof_photo_path set, reason set',
        row?.status === 'needs_review' && row?.proof_photo_path === `claims/${claimId}/proof.jpg` && row?.reason === 'Owner uploaded a photo as proof.',
        JSON.stringify(row && { status: row.status, proof: row.proof_photo_path, reason: row.reason }));
      const proofNotes = async () =>
        (await service.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', ids.R2).eq('link', `/claims/${claimId}`).ilike('text', '%proof photo%')).count;
      check('3 finder R2 notified once about the proof', (await proofNotes()) === 1);
      const ok2 = await proof(A, jpegFile('proof2.jpg'));
      check('3 A replaces proof while needs_review -> 200', ok2.status === 200 && ok2.body?.status === 'needs_review', short(ok2));
      check('3 replacing proof sends no second notification', (await proofNotes()) === 1);

      const an = await call('POST', `/api/claims/${claimId}/answers`, A, { answers: qs.map((q) => ({ question_id: q?.id, answer: 'zz-test answer' })) });
      check('3 /answers after proof -> 409', errIs(an, 409), short(an));

      const fv = await call('GET', `/api/claims/${claimId}`, R2);
      check('3 finder GET claim -> 200 viewer finder', fv.status === 200 && fv.body?.viewer === 'finder', short(fv));
      check('3 finder sees signed proof_photo_url', signed(fv.body?.proof_photo_url), String(fv.body?.proof_photo_url).slice(0, 80));
      check('3 finder sees signed owner_photo_url', signed(fv.body?.owner_photo_url), String(fv.body?.owner_photo_url).slice(0, 80));
      const av = await call('GET', `/api/claims/${claimId}`, A);
      check('3 claimant GET claim has no proof_photo_url / owner_photo_url',
        av.status === 200 && av.body?.viewer === 'claimant' && !('proof_photo_url' in (av.body ?? {})) && !('owner_photo_url' in (av.body ?? {})), short(av));

      const f = await service.from('claims').update({ status: 'likely_owner', pickup_code: String(randomInt(0, 1000000)).padStart(6, '0') }).eq('id', claimId);
      check('setup force claim likely_owner', !f.error, f.error?.message);
      const late = await proof(A, jpegFile('proof.jpg'));
      check(`3 proof on likely_owner claim -> 409 "Proof can't be added to this claim now."`, errIs(late, 409, "Proof can't be added to this claim now."), short(late));
      check('3 db claim still likely_owner', (await claimRow())?.status === 'likely_owner');
    }

    // ---- 4. Reports: validation, message participants ----
    const report = (token: string, targetType: string, targetId: string, reason: string = REASON) =>
      call('POST', '/api/reports', token, { targetType, targetId, reason });
    const r0 = await call('POST', '/api/reports', undefined, { targetType: 'item', targetId: TI.id, reason: REASON });
    check('4 report without token -> 401', r0.status === 401, short(r0));
    const own = await report(T, 'item', TI.id);
    check(`4 T reports own item -> 400 "You can't report yourself."`, errIs(own, 400, "You can't report yourself."), short(own));
    const unk = await report(R1, 'item', randomUUID());
    check("4 unknown item -> 404 'Not found'", errIs(unk, 404, 'Not found'), short(unk));
    const empty = await report(R1, 'item', TI.id, '   ');
    check('4 blank reason -> 400', errIs(empty, 400), short(empty));
    const long = await report(R1, 'item', TI.id, 'x'.repeat(501));
    check('4 501-char reason -> 400', errIs(long, 400), short(long));
    const kind = await report(R1, 'claim', claimId);
    check("4 targetType 'claim' -> 400", errIs(kind, 400), short(kind));
    const bj = await call('POST', '/api/reports', R1, '{not json');
    check("4 bad JSON -> 400 'Invalid JSON'", errIs(bj, 400, 'Invalid JSON'), short(bj));

    const msg = await service.from('messages').insert({ claim_id: claimId, sender_id: ids.A, body: 'zz-test hello' }).select('id').single();
    check('setup message in the P chat', !msg.error, msg.error?.message);
    const msgId = String(msg.data?.id ?? '');
    const outsider = await report(F, 'message', msgId);
    check("4 non-participant reports message -> 404 'Not found'", errIs(outsider, 404, 'Not found'), short(outsider));
    const inside = await report(R2, 'message', msgId);
    check('4 finder (participant) reports message -> 200 { ok: true }', inside.status === 200 && sameKeys(inside.body, ['ok']) && inside.body?.ok === true, short(inside));

    // ---- 5. Rate limit + auto-flag ----
    const flagged = async (id: string) => (await service.from('users').select('flagged').eq('id', id).maybeSingle()).data?.flagged;
    const first = await report(R1, 'item', TI.id);
    check("5 R1 reports T's item -> 200 { ok: true }", first.status === 200 && sameKeys(first.body, ['ok']) && first.body?.ok === true, short(first));
    const stored = await service.from('abuse_reports').select('target_type, reason').eq('reporter_id', ids.R1).eq('target_id', TI.id);
    check('5 db report stored with reason', stored.data?.length === 1 && stored.data[0].target_type === 'item' && stored.data[0].reason === REASON, JSON.stringify(stored.data ?? stored.error));
    const more: number[] = [];
    for (let i = 2; i <= 10; i++) more.push((await report(R1, 'item', TI.id)).status);
    check('5 R1 reports 2..10 (duplicates allowed) -> 200', more.every((s) => s === 200), more.join(','));
    const lim = await report(R1, 'item', TI.id);
    check(`5 R1 11th report in 24 h -> 429 "You've reached the limit of 10 reports in 24 hours."`, errIs(lim, 429, "You've reached the limit of 10 reports in 24 hours."), short(lim));
    check('5 T not flagged after 1 distinct reporter (10 reports)', (await flagged(ids.T)) === false);
    const r2 = await report(R2, 'item', TI.id);
    check('5 R2 reports T -> 200', r2.status === 200, short(r2));
    check('5 T not flagged after 2 distinct reporters', (await flagged(ids.T)) === false);
    const r3 = await report(R3, 'user', ids.T);
    check('5 R3 reports T (user target) -> 200', r3.status === 200 && r3.body?.ok === true, short(r3));
    check('5 T flagged after 3 distinct reporters', (await flagged(ids.T)) === true);
    const lfd = new FormData();
    for (const [k, v] of Object.entries({ text: 'zz-test lost bottle', buildingIds: JSON.stringify([BUILDING]), notSure: 'false', landmarks: '[]' })) lfd.append(k, v);
    const tl = await call('POST', '/api/lost', T, lfd);
    check(`5 flagged T POST /api/lost -> 403 '${PAUSED}'`, errIs(tl, 403, PAUSED), short(tl));
    const tr = await report(T, 'user', ids.R1);
    check(`5 flagged T POST /api/reports -> 403`, errIs(tr, 403, PAUSED), short(tr));
    const dr = [await report(R2, 'user', ids.D), await report(R3, 'user', ids.D), await report(F, 'user', ids.D)];
    check('5 R2, R3, F report desk user D -> 200', dr.every((r) => r.status === 200), dr.map(short).join(' | '));
    const dCount = await service.from('abuse_reports').select('id', { count: 'exact', head: true }).eq('target_id', ids.D);
    check('5 db 3 reports on D stored', dCount.count === 3, `${dCount.count ?? dCount.error?.message}`);
    check('5 desk user D stays unflagged', (await flagged(ids.D)) === false);

    // ---- 6. Sweep + nudges (finder F) ----
    const links = [U1, U2, N1, N2, FR].flatMap((i) => [`/my?nudge=held-${i.code}`, `/my?nudge=desk-${i.code}`]);
    const nudgeCounts = async () => {
      const { data, error } = await service.from('notifications').select('link').eq('user_id', ids.F).in('link', links);
      if (error) throw new Error(error.message);
      const m = new Map<string, number>();
      for (const n of data ?? []) m.set(n.link, (m.get(n.link) ?? 0) + 1);
      return m;
    };
    const expectNudges = async (label: string) => {
      const m = await nudgeCounts();
      const held = `/my?nudge=held-${N1.code}`;
      const desk = `/my?nudge=desk-${N2.code}`;
      check(`${label} exactly one held nudge for N1, one desk nudge for N2`, m.get(held) === 1 && m.get(desk) === 1, JSON.stringify([...m]));
      check(`${label} no nudges for U1, U2, FR`, [...m.keys()].every((l) => l === held || l === desk), JSON.stringify([...m]));
    };
    const me1 = await call('GET', '/api/me/items', F);
    check('6 F GET /api/me/items -> 200', me1.status === 200, short(me1));
    check('6 db U1 (31 d, only an awaiting_answers claim) unclaimed', (await itemRow(U1.id))?.status === 'unclaimed');
    const u1Claim = (await service.from('claims').select('status, pickup_code').eq('id', u1c.data?.id ?? '').maybeSingle()).data;
    check("6 db U1's open claim -> rejected, pickup_code null", u1Claim?.status === 'rejected' && u1Claim?.pickup_code === null, JSON.stringify(u1Claim));
    check('6 db U2 (31 d, likely_owner claim) still with_finder', (await itemRow(U2.id))?.status === 'with_finder');
    check('6 db N1, N2, FR still open', (await itemRow(N1.id))?.status === 'with_finder' && (await itemRow(N2.id))?.status === 'en_route_to_desk' && (await itemRow(FR.id))?.status === 'with_finder');
    await expectNudges('6 after first sweep:');
    const nl = await call('GET', '/api/notifications', F);
    check('6 F GET /api/notifications -> 200 with the N1 nudge', nl.status === 200 && arr(nl.body).some((n) => n?.link === `/my?nudge=held-${N1.code}`), short(nl));
    check('6 notifications keys == id, text, link, created_at, read', arr(nl.body).length > 0 && arr(nl.body).every((n) => sameKeys(n, ['id', 'text', 'link', 'created_at', 'read'])), JSON.stringify(arr(nl.body)[0] ?? null));
    const me2 = await call('GET', '/api/me/items', F);
    check('6 F GET /api/me/items again -> 200', me2.status === 200, short(me2));
    const par = await Promise.all([call('GET', '/api/notifications', F), call('GET', '/api/me/items', F), call('GET', '/api/notifications', F)]);
    check('6 concurrent notifications + me/items -> all 200', par.every((r) => r.status === 200), par.map(short).join(' | '));
    await expectNudges('6 after repeated + concurrent sweeps:');
    const li = await call('GET', '/api/items');
    check('6 GET /api/items -> 200 without unclaimed U1', li.status === 200 && Array.isArray(li.body) && !arr(li.body).some((i) => i?.id === U1.id), short(li));

    // ---- 7. Privacy scan over every response ----
    const KEYS = ['photo_paths', 'blurred_thumb_path', 'proof_photo_path', 'owner_photo_path'];
    // Signed URLs carry their storage path; strip them before looking for raw paths.
    const PATH_RE = /(found|lost|claims)\/[0-9a-f-]{36}\/[\w.-]+\.jpg/i;
    const banned: [string, string][] = [
      ...Object.entries(emails).map(([k, e]): [string, string] => [`email ${k}`, e]),
      ...Object.entries(ids).map(([k, id]): [string, string] => [`user id ${k}`, id]),
      ['report reason', `RSN${rand}`],
    ];
    const hits = seen.flatMap((s) => {
      const bare = s.res.text.replace(/https?:\/\/[^\s"]+/g, '');
      const found = [
        ...KEYS.filter((k) => s.res.text.includes(k)),
        ...(PATH_RE.test(bare) ? ['storage path'] : []),
        ...banned.filter(([, b]) => b && bare.includes(b)).map(([l]) => l),
      ];
      return found.length ? [`${s.what}: ${found.join(', ')}`] : [];
    });
    check(`7 no response (of ${seen.length}) has path keys, raw storage paths, test emails, user ids or report reasons`, hits.length === 0, hits.join(' | '));
  } finally {
    // ---- 8. Cleanup: abuse_reports -> claims -> reports -> items + storage -> notifications -> auth users -> desk -> building ----
    await purge(service, created);
    if (storagePaths.length) await service.storage.from('photos').remove(storagePaths);
    await dropAuthUsers(service, created);
    const count = async (label: string, q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
      const r = await q;
      const n = r.error ? -1 : (r.count ?? 0);
      if (n !== 0) failed++;
      console.log(n === 0 ? `ok leftover ${label}: 0` : `FAIL leftover ${label}: ${r.error ? r.error.message : n}`);
    };
    const head = { count: 'exact' as const, head: true };
    if (created.length) {
      await count('abuse_reports (reporters)', service.from('abuse_reports').select('id', head).in('reporter_id', created));
      await count('abuse_reports (user targets)', service.from('abuse_reports').select('id', head).in('target_id', created));
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
    for (const p of storagePaths) {
      const dir = p.slice(0, p.lastIndexOf('/'));
      const { data, error } = await service.storage.from('photos').list(dir);
      const left = error ? -1 : (data ?? []).filter((o) => o.name === p.slice(dir.length + 1)).length;
      if (left !== 0) failed++;
      console.log(left === 0 ? `ok leftover storage ${dir}/: 0` : `FAIL leftover storage ${p}: ${error ? error.message : left}`);
    }
  }

  console.log(failed ? `${failed} checks failed` : 'F checks passed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('FAIL unexpected error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
