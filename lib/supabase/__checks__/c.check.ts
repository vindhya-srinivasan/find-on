// Phase C lost-flow check. Needs `npm run dev` up (or BASE_URL): npx tsx lib/supabase/__checks__/c.check.ts
/* eslint-disable @typescript-eslint/no-explicit-any -- probes untyped JSON responses on purpose */
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';

let failed = 0;
function check(label: string, pass: boolean, detail?: string) {
  if (!pass) failed++;
  console.log(pass ? `ok ${label}` : `FAIL ${label}${detail ? `: ${detail}` : ''}`);
}

// Mirrors PublicFoundItem / NotificationItem in types/index.ts (no app imports here on purpose).
const PUBLIC_KEYS = [
  'id', 'item_code', 'public_title', 'category', 'color', 'found_building_id', 'found_date',
  'blurred_thumb_url', 'status', 'return_method', 'held_at_desk_id',
].sort();
const MATCH_KEYS = ['candidate_id', 'score', 'public_reason', 'item'].sort();
const NOTIF_KEYS = ['id', 'text', 'link', 'created_at', 'read'].sort();
const BA = 'zz-test-a';
const BB = 'zz-test-b';
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

type Res = { status: number; text: string; body: any };
async function call(method: 'GET' | 'POST', path: string, token?: string, fd?: FormData): Promise<Res> {
  const r = await fetch(BASE + path, { method, body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const text = await r.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    // non-JSON body; checks report the status
  }
  return { status: r.status, text, body };
}
const short = (r: Res) => `${r.status} ${r.text.slice(0, 200)}`;
const sameKeys = (o: any, keys: string[]) => !!o && typeof o === 'object' && JSON.stringify(Object.keys(o).sort()) === JSON.stringify(keys);

// Each step independent so one failure doesn't strand the rest. FK order: claims, then reports/items, then users.
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
    await step('claims', async () => ok(await service.from('claims').delete().in('claimant_id', userIds)));
    await step('lost_reports', async () => {
      const { data, error } = await service.from('lost_reports').select('id').in('owner_id', userIds);
      if (error) throw new Error(error.message);
      const paths = (data ?? []).map((r) => `lost/${r.id}/photo.jpg`);
      if (paths.length) await service.storage.from('photos').remove(paths);
      ok(await service.from('lost_reports').delete().in('owner_id', userIds));
    });
    await step('found_items', async () => {
      const { data, error } = await service.from('found_items').select('photo_paths, blurred_thumb_path').in('finder_id', userIds);
      if (error) throw new Error(error.message);
      const paths = (data ?? []).flatMap((r) => [...(r.photo_paths ?? []), r.blurred_thumb_path]).filter(Boolean);
      if (paths.length) await service.storage.from('photos').remove(paths);
      ok(await service.from('found_items').delete().in('finder_id', userIds)); // matches cascade
    });
    await step('notifications (users)', async () => ok(await service.from('notifications').delete().in('user_id', userIds)));
  }
  // Matching also notifies real open reports; text embeds the test item's public_title "... · zz-test-a".
  await step('notifications (zz-test)', async () => ok(await service.from('notifications').delete().ilike('text', '%zz-test%')));
  await step('buildings', async () => ok(await service.from('buildings').delete().in('id', [BA, BB])));
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
      for (const id of stale) await service.auth.admin.deleteUser(id);
    } catch {
      // best effort
    }
    // Off-campus coordinates so matching never pairs test items with real lost reports by distance.
    const bIns = await service.from('buildings').insert([
      { id: BA, name: BA, lat: 0, lng: 0, type: 'academic' },
      { id: BB, name: BB, lat: 0, lng: 0.001, type: 'academic' },
    ]);
    check('setup insert buildings', !bIns.error, bIns.error?.message);

    const rand = randomBytes(4).toString('hex');
    const emailA = `fo-check-${rand}-a@usc.edu`;
    const emailB = `fo-check-${rand}-b@usc.edu`;
    const tokens: Record<string, string> = {};
    const ids: Record<string, string> = {};
    for (const email of [emailA, emailB]) {
      const password = randomBytes(18).toString('base64url');
      const cu = await service.auth.admin.createUser({ email, password, email_confirm: true });
      if (cu.error || !cu.data.user) {
        check(`setup create user ${email}`, false, cu.error?.message);
        continue;
      }
      created.push(cu.data.user.id);
      ids[email] = cu.data.user.id;
      const si = await createClient(url, anonKey, opts).auth.signInWithPassword({ email, password });
      check(`setup sign in ${email}`, !!si.data.session, si.error?.message);
      if (si.data.session) tokens[email] = si.data.session.access_token;
    }
    const A = tokens[emailA];
    const B = tokens[emailB];
    const aId = ids[emailA] ?? '';
    const bId = ids[emailB] ?? '';
    if (!A || !B) throw new Error('setup failed: no tokens');

    const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 120, g: 120, b: 120 } } }).jpeg().toBuffer();
    const file = (name: string) => new File([new Uint8Array(jpeg)], name, { type: 'image/jpeg' });
    // "pink" matches the lost text, so the real AI scores the pair reliably >= 50.
    const secret = { detail: `pink HIDDENDETAIL${rand} sticker`, brand: `ZBR${rand}`, landmark: `LMK${rand}` };
    const banned: [string, string][] = [
      ['detail text', secret.detail], ['brand text', secret.brand], ['landmark text', secret.landmark],
      ['finder id', bId], ['finder email', emailB], ['photo_paths', 'photo_paths'], ['hidden_details', 'hidden_details'],
      ['finder_id', 'finder_id'], ['owner_photo_path', 'owner_photo_path'], ['lost photo path', 'photo.jpg'],
    ];
    const leaks = (text: string) => banned.filter(([, s]) => text.includes(s)).map(([label]) => label);

    const foundForm = () => {
      const fd = new FormData();
      fd.append('photos', file('item.jpg'));
      fd.append('buildingId', BA);
      fd.append('landmark', secret.landmark);
      fd.append('foundAt', new Date().toISOString());
      fd.append('analysis', JSON.stringify({
        is_valid_item: true, reject_reason: null, category: 'water bottle', color: 'grey', brand: secret.brand,
        public_title: 'Grey water bottle', hidden_details: [{ detail: secret.detail, weight: 3 }],
        verifiability: 'high', is_valuable: false,
      }));
      fd.append('returnMethod', 'desk');
      return fd;
    };
    const lostForm = (over: Record<string, string> = {}, photo = false) => {
      const fd = new FormData();
      const fields = { text: 'Grey water bottle with a pink sticker, lost today zz-test', buildingIds: JSON.stringify([BB]), notSure: 'false', landmarks: '[]', ...over };
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      if (photo) fd.append('photo', file('mine.jpg'));
      return fd;
    };

    // ---- 1. no token ----
    const someId = randomUUID();
    check('1 POST /api/lost without token -> 401', (await call('POST', '/api/lost', undefined, lostForm())).status === 401);
    check('1 GET matches without token -> 401', (await call('GET', `/api/lost/${someId}/matches`)).status === 401);
    check('1 POST close without token -> 401', (await call('POST', `/api/lost/${someId}/close`)).status === 401);
    check('1 GET notifications without token -> 401', (await call('GET', '/api/notifications')).status === 401);

    // ---- 2. B finds, A loses ----
    const f1 = await call('POST', '/api/found', B, foundForm());
    const item1: string = f1.body?.item?.id ?? '';
    check('2 B found -> 200', f1.status === 200 && !!item1, short(f1));

    const lr = await call('POST', '/api/lost', A, lostForm({}, true));
    const reportId: string = lr.body?.reportId ?? '';
    const matches: any[] = Array.isArray(lr.body?.matches) ? lr.body.matches : [];
    check('2 A lost -> 200 with reportId, parsed, matches', lr.status === 200 && !!reportId && !!lr.body?.parsed && Array.isArray(lr.body?.matches), short(lr));
    check('2 matches include B item', matches.some((m) => m?.item?.id === item1), `${matches.length} matches`);

    // ---- 3. shapes + leaks ----
    check('3 match keys exact', matches.length > 0 && matches.every((m) => sameKeys(m, MATCH_KEYS)), JSON.stringify(matches[0] && Object.keys(matches[0])));
    check('3 match item keys == PublicFoundItem', matches.length > 0 && matches.every((m) => sameKeys(m.item, PUBLIC_KEYS)), JSON.stringify(matches[0]?.item && Object.keys(matches[0].item)));
    const l1 = leaks(lr.text);
    check('3 lost response leaks nothing private', l1.length === 0, `contains ${l1.join(', ')}`);

    // ---- 4. DB rows ----
    if (reportId) {
      const row = await service.from('lost_reports').select('owner_id, status, building_ids, owner_photo_path').eq('id', reportId).maybeSingle();
      check('4 db lost_reports row', !row.error && row.data?.owner_id === aId && row.data?.status === 'open', row.error?.message ?? JSON.stringify(row.data));
      check('4 db owner_photo_path saved', row.data?.owner_photo_path === `lost/${reportId}/photo.jpg`, `${row.data?.owner_photo_path}`);
      const m = await service.from('matches').select('id').eq('lost_report_id', reportId).eq('found_item_id', item1);
      check('4 db matches row', !m.error && (m.data?.length ?? 0) === 1, m.error?.message ?? `${m.data?.length} rows`);
    }

    // ---- 5. GET matches ----
    const gm = await call('GET', `/api/lost/${reportId}/matches`, A);
    check('5 A GET own matches -> 200 with B item', gm.status === 200 && Array.isArray(gm.body) && gm.body.some((x: any) => x?.item?.id === item1), short(gm));
    const gl = leaks(gm.text);
    check('5 matches response leaks nothing private', gl.length === 0, `contains ${gl.join(', ')}`);
    const gb = await call('GET', `/api/lost/${reportId}/matches`, B);
    check("5 B GET A's matches -> 404", gb.status === 404, short(gb));
    const gx = await call('GET', '/api/lost/not-a-uuid/matches', A);
    check('5 GET not-a-uuid matches -> 404', gx.status === 404, short(gx));

    // ---- 6. unknown building ----
    const ub = await call('POST', '/api/lost', A, lostForm({ buildingIds: JSON.stringify(['zz-test-nope']) }));
    check('6 unknown building -> 400', ub.status === 400 && ub.body?.error === 'buildingIds: unknown building', short(ub));

    // ---- 7. notifications ----
    const f2 = await call('POST', '/api/found', B, foundForm());
    const item2: string = f2.body?.item?.id ?? '';
    check('7 B second found -> 200', f2.status === 200 && !!item2, short(f2));
    const n1 = await call('GET', '/api/notifications', A);
    const list1: any[] = Array.isArray(n1.body) ? n1.body : [];
    const mine = list1.find((n) => n?.link === `/lost/${reportId}`);
    check('7 notification for report', n1.status === 200 && !!mine, short(n1));
    check('7 notification keys exact', list1.length > 0 && list1.every((n) => sameKeys(n, NOTIF_KEYS)), JSON.stringify(list1[0] && Object.keys(list1[0])));
    check('7 first GET read false', mine?.read === false, `${mine?.read}`);
    const nl = leaks(n1.text);
    check('7 notifications leak nothing private', nl.length === 0, `contains ${nl.join(', ')}`);
    const n2 = await call('GET', '/api/notifications', A);
    const again = (Array.isArray(n2.body) ? n2.body : []).find((n: any) => n?.id === mine?.id);
    check('7 second GET read true', n2.status === 200 && again?.read === true, short(n2));

    // ---- 8. 5 open reports -> 409 ----
    const now = new Date().toISOString();
    const fill = await service.from('lost_reports').insert(
      Array.from({ length: 4 }, () => ({ owner_id: aId, raw_text: 'zz-test filler', category: 'other', time_start: now, time_end: now })),
    );
    check('8 setup filler reports', !fill.error, fill.error?.message);
    const cap = await call('POST', '/api/lost', A, lostForm());
    check('8 sixth open report -> 409', cap.status === 409, short(cap));

    // ---- 9. close ----
    const cl = await service.from('claims').insert([
      { found_item_id: item1, lost_report_id: reportId, claimant_id: aId, status: 'awaiting_answers', attempt_no: 1 },
      { found_item_id: item1, lost_report_id: reportId, claimant_id: aId, status: 'approved', attempt_no: 2 },
    ]);
    check('9 setup claims', !cl.error, cl.error?.message);
    const bc = await call('POST', `/api/lost/${reportId}/close`, B);
    check("9 B close of A's report -> 404", bc.status === 404, short(bc));
    const c1 = await call('POST', `/api/lost/${reportId}/close`, A);
    check('9 close -> 200 closed', c1.status === 200 && sameKeys(c1.body, ['status']) && c1.body.status === 'closed', short(c1));
    const rr = await service.from('lost_reports').select('status').eq('id', reportId).maybeSingle();
    check('9 db report closed', rr.data?.status === 'closed', `${rr.data?.status}`);
    const cs = await service.from('claims').select('status').eq('lost_report_id', reportId);
    check('9 db claims rejected', !cs.error && (cs.data?.length ?? 0) === 2 && cs.data!.every((c) => c.status === 'rejected'), JSON.stringify(cs.data));
    const c2 = await call('POST', `/api/lost/${reportId}/close`, A);
    check('9 second close -> 200 closed', c2.status === 200 && c2.body?.status === 'closed', short(c2));
  } finally {
    // ---- Cleanup ----
    await purge(service, created);
    const count = async (label: string, q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
      const r = await q;
      const n = r.error ? -1 : (r.count ?? 0);
      if (n !== 0) failed++;
      console.log(n === 0 ? `ok leftover ${label}: 0` : `FAIL leftover ${label}: ${r.error ? r.error.message : n}`);
    };
    const head = { count: 'exact' as const, head: true };
    if (created.length) {
      await count('claims', service.from('claims').select('id', head).in('claimant_id', created));
      await count('lost_reports', service.from('lost_reports').select('id', head).in('owner_id', created));
      await count('found_items', service.from('found_items').select('id', head).in('finder_id', created));
      await count('notifications (users)', service.from('notifications').select('id', head).in('user_id', created));
    }
    await count('notifications (zz-test)', service.from('notifications').select('id', head).ilike('text', '%zz-test%'));
    await count('buildings', service.from('buildings').select('id', head).in('id', [BA, BB]));
    for (const id of created) {
      try {
        // public.users cascades from auth.users
        await service.auth.admin.deleteUser(id);
      } catch (e) {
        console.log(`cleanup auth user failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  console.log(failed ? `${failed} checks failed` : 'C checks passed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('FAIL unexpected error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
