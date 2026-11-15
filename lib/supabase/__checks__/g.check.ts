// Desk choice check (deskId on /api/found and return-method). Needs npm run dev up (or BASE_URL): npx tsx lib/supabase/__checks__/g.check.ts
/* eslint-disable @typescript-eslint/no-explicit-any -- probes untyped JSON responses on purpose */
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';

let failed = 0;
function check(label: string, pass: boolean, detail?: string) {
  if (!pass) failed++;
  console.log(pass ? `ok ${label}` : `FAIL ${label}${detail ? `: ${detail}` : ''}`);
}

// Name contains zz-test so the notification cleanup (text ilike '%zz-test%') also catches stray rows.
const BUILDING = 'zz-test-g';
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const UNKNOWN = 'deskId: unknown desk';

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
const errIs = (r: Res, status: number, msg?: string) => r.status === status && (msg === undefined || r.body?.error === msg);

// Each step independent so one failure doesn't strand the rest. Only rows owned by this run's users are touched.
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
    await step('abuse_reports (reporters)', async () => ok(await service.from('abuse_reports').delete().in('reporter_id', userIds)));
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

// After items are gone (found_items reference buildings). Never touches the real 'dps' / 'its' desks.
async function dropAuthUsers(service: SupabaseClient, userIds: string[]) {
  for (const id of userIds) {
    try {
      // public.users cascades from auth.users
      await service.auth.admin.deleteUser(id);
    } catch (e) {
      console.log(`cleanup auth user failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
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
  const emails: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const rand = randomBytes(4).toString('hex');

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
    // Off-campus coordinates so matching never pairs test items with real lost reports (no AI calls).
    const bIns = await service.from('buildings').insert({ id: BUILDING, name: BUILDING, lat: 0, lng: 0, type: 'academic' });
    check('setup insert building', !bIns.error, bIns.error?.message);

    // Same query /api/found uses for the default desk.
    const dpsQ = await service.from('desks').select('id').ilike('name', '%dps%').order('id').limit(1).maybeSingle();
    const dps: string | null = dpsQ.data?.id ?? null;
    if (!dps) console.log('NOTE: no desk named like %dps%; DPS equality asserts skipped');
    const itsQ = await service.from('desks').select('id').eq('id', 'its').maybeSingle();
    const hasIts = !!itsQ.data;
    if (!hasIts) console.log("SKIP: desks has no 'its' row (run the ITS-desk SQL); its cases skipped");

    const meta = { first_name: 'Gina', last_initial: 'S' };
    const email = `fo-check-${rand}-s@usc.edu`;
    emails.S = email;
    const password = randomBytes(18).toString('base64url');
    const cu = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta });
    if (cu.error || !cu.data.user) throw new Error(`setup create user: ${cu.error?.message}`);
    created.push(cu.data.user.id);
    ids.S = cu.data.user.id;
    const si = await createClient(url, anonKey, opts).auth.signInWithPassword({ email, password });
    check('setup sign in S', !!si.data.session, si.error?.message);
    const S = si.data.session?.access_token;
    if (!S) throw new Error('setup failed: no token');
    // First API call creates the student's users row.
    const n = await call('GET', '/api/notifications', S);
    check('setup S first call -> 200', n.status === 200, short(n));

    const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 90, g: 90, b: 140 } } }).jpeg().toBuffer();
    const postItem = (returnMethod: 'desk' | 'finder', deskId?: string) => {
      const fd = new FormData();
      fd.append('photos', new File([new Uint8Array(jpeg)], 'item.jpg', { type: 'image/jpeg' }));
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
      if (deskId !== undefined) fd.append('deskId', deskId);
      return call('POST', '/api/found', S, fd);
    };
    const itemRow = async (id: string) =>
      (await service.from('found_items').select('status, held_at_desk_id').eq('id', id).maybeSingle()).data;
    const itemCount = async () =>
      (await service.from('found_items').select('id', { count: 'exact', head: true }).eq('finder_id', ids.S)).count;
    // Response and DB both held at `desk` with `status`.
    const expectHeld = async (label: string, r: Res, status: string, desk: string | null) => {
      check(`${label} -> 200`, r.status === 200 && !!r.body?.item?.id, short(r));
      const it = r.body?.item;
      check(`${label} response status ${status}, held_at_desk_id ${desk}`, it?.status === status && it?.held_at_desk_id === desk, short(r));
      const row = it?.id ? await itemRow(String(it.id)) : null;
      check(`${label} db status ${status}, held_at_desk_id ${desk}`, row?.status === status && row?.held_at_desk_id === desk, JSON.stringify(row));
    };

    // ---- 1. Desk item, no deskId -> DPS ----
    const r1 = await postItem('desk');
    if (dps) await expectHeld('1 desk item, no deskId', r1, 'en_route_to_desk', dps);
    else check('1 desk item, no deskId -> 200 en_route_to_desk', r1.status === 200 && r1.body?.item?.status === 'en_route_to_desk', short(r1));

    // ---- 2-3. deskId 'its' (and untrimmed / uppercase) ----
    if (hasIts) {
      await expectHeld("2 deskId 'its'", await postItem('desk', 'its'), 'en_route_to_desk', 'its');
      await expectHeld("3 deskId ' ITS '", await postItem('desk', ' ITS '), 'en_route_to_desk', 'its');
    }

    // ---- 4-5. Bad deskId -> 400, nothing saved ----
    const before = await itemCount();
    const r4 = await postItem('desk', 'nope');
    check(`4 deskId 'nope' -> 400 '${UNKNOWN}'`, errIs(r4, 400, UNKNOWN), short(r4));
    const r5 = await postItem('desk', 'x'.repeat(21));
    check("5 21-char deskId -> 400 starting 'deskId'", errIs(r5, 400) && String(r5.body?.error ?? '').startsWith('deskId'), short(r5));
    const after = await itemCount();
    check('4-5 db found_items count unchanged', before !== null && after === before, `${before} -> ${after}`);

    // ---- 6. returnMethod finder ignores deskId ----
    await expectHeld("6 returnMethod finder + deskId 'nope'", await postItem('finder', 'nope'), 'with_finder', null);

    // ---- 7. return-method with deskId ----
    const h1 = await postItem('finder');
    const h1Id = String(h1.body?.item?.id ?? '');
    check('7 finder item H1 -> 200', h1.status === 200 && !!h1Id, short(h1));
    const switchDesk = (id: string, deskId?: string) =>
      call('POST', `/api/items/${id}/return-method`, S, deskId === undefined ? { returnMethod: 'desk' } : { returnMethod: 'desk', deskId });
    const bad = await switchDesk(h1Id, 'nope');
    check(`7 return-method deskId 'nope' -> 400 '${UNKNOWN}'`, errIs(bad, 400, UNKNOWN), short(bad));
    const h1Row = await itemRow(h1Id);
    check('7 db H1 still with_finder, held_at_desk_id null', h1Row?.status === 'with_finder' && h1Row?.held_at_desk_id === null, JSON.stringify(h1Row));
    if (hasIts) await expectHeld("7 return-method deskId 'its'", await switchDesk(h1Id, 'its'), 'en_route_to_desk', 'its');
    const h2 = await postItem('finder');
    const h2Id = String(h2.body?.item?.id ?? '');
    check('7 finder item H2 -> 200', h2.status === 200 && !!h2Id, short(h2));
    const r7 = await switchDesk(h2Id);
    if (dps) await expectHeld('7 return-method no deskId', r7, 'en_route_to_desk', dps);
    else check('7 return-method no deskId -> 200 en_route_to_desk', r7.status === 200 && r7.body?.item?.status === 'en_route_to_desk', short(r7));

    // ---- 8. Privacy scan over every response ----
    const KEYS = ['photo_paths', 'blurred_thumb_path', 'proof_photo_path', 'owner_photo_path'];
    // Signed URLs carry their storage path; strip them before looking for raw paths.
    const PATH_RE = /(found|lost|claims)\/[0-9a-f-]{36}\/[\w.-]+\.jpg/i;
    const banned: [string, string][] = [
      ...Object.entries(emails).map(([k, e]): [string, string] => [`email ${k}`, e]),
      ...Object.entries(ids).map(([k, id]): [string, string] => [`user id ${k}`, id]),
      ['hidden detail', `HDA${rand}`],
      ['hidden detail', `HDB${rand}`],
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
    check(`8 no response (of ${seen.length}) has path keys, raw storage paths, test emails, user ids or hidden details`, hits.length === 0, hits.join(' | '));
  } finally {
    // ---- Cleanup: items + storage -> notifications -> auth users -> building ----
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
      await count('found_items', service.from('found_items').select('id', head).in('finder_id', created));
      await count('notifications (users)', service.from('notifications').select('id', head).in('user_id', created));
      await count('users', service.from('users').select('id', head).in('id', created));
    }
    await count('notifications (zz-test)', service.from('notifications').select('id', head).ilike('text', '%zz-test%'));
    await count('buildings', service.from('buildings').select('id', head).eq('id', BUILDING));
  }

  console.log(failed ? `${failed} checks failed` : 'G checks passed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('FAIL unexpected error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
