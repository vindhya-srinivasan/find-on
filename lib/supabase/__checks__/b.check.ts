// Phase B found-flow check. Needs `npm run dev` up (or BASE_URL): npx tsx lib/supabase/__checks__/b.check.ts
/* eslint-disable @typescript-eslint/no-explicit-any -- probes untyped JSON responses on purpose */
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';

let failed = 0;
function check(label: string, pass: boolean, detail?: string) {
  if (!pass) failed++;
  console.log(pass ? `ok ${label}` : `FAIL ${label}${detail ? `: ${detail}` : ''}`);
}

// Mirrors PublicFoundItem in types/index.ts (no app imports here on purpose).
const PUBLIC_KEYS = [
  'id', 'item_code', 'public_title', 'category', 'color', 'found_building_id', 'found_date',
  'blurred_thumb_url', 'status', 'return_method', 'held_at_desk_id',
].sort();
const ANALYSIS_KEYS = [
  'is_valid_item', 'reject_reason', 'category', 'color', 'brand', 'public_title',
  'hidden_details', 'verifiability', 'is_valuable',
];
const BUILDING = 'zz-test';
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

type Res = { status: number; text: string; body: any };
async function post(path: string, fd: FormData, token?: string): Promise<Res> {
  const r = await fetch(BASE + path, { method: 'POST', body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {} });
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

async function purgeFinder(service: SupabaseClient, finderId: string) {
  const { data } = await service.from('found_items').select('id, photo_paths, blurred_thumb_path').eq('finder_id', finderId);
  for (const row of data ?? []) {
    const paths = [...(row.photo_paths ?? []), row.blurred_thumb_path].filter(Boolean);
    if (paths.length) await service.storage.from('photos').remove(paths);
    await service.from('found_items').delete().eq('id', row.id);
  }
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
  let uscId = '';

  try {
    // ---- Setup ----
    // Stale leftovers from older runs (best effort).
    try {
      const { data } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
      for (const u of data?.users ?? []) {
        if (!u.email?.startsWith('fo-check-')) continue;
        await purgeFinder(service, u.id);
        await service.auth.admin.deleteUser(u.id);
      }
    } catch {
      // best effort
    }
    await service.from('buildings').delete().eq('id', BUILDING);
    // Off-campus coordinates so matching never pairs test items with real lost reports.
    const bIns = await service.from('buildings').insert({ id: BUILDING, name: BUILDING, lat: 0, lng: 0, type: 'academic' });
    check('setup insert building zz-test', !bIns.error, bIns.error?.message);

    const rand = randomBytes(4).toString('hex');
    const uscEmail = `fo-check-${rand}@usc.edu`;
    const otherEmail = `fo-check-${rand}@example.com`;
    const tokens: Record<string, string> = {};
    const ids: Record<string, string> = {};
    for (const email of [uscEmail, otherEmail]) {
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
    uscId = ids[uscEmail] ?? '';
    const usc = tokens[uscEmail];
    const other = tokens[otherEmail];
    if (!usc || !other) throw new Error('setup failed: no tokens');

    const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 30, b: 30 } } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'fo-secret', Artist: 'fo-secret' } })
      .toBuffer();
    const meta = await sharp(jpeg).metadata();
    check('setup test jpeg carries EXIF', meta.exif !== undefined, 'sharp did not write EXIF');

    const form = (fields: Record<string, string>) => {
      const fd = new FormData();
      fd.append('photos', new File([new Uint8Array(jpeg)], 'item.jpg', { type: 'image/jpeg' }));
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      return fd;
    };
    const secret = {
      title: `SPOOFTITLE${rand}`,
      detail: `HIDDENDETAIL${rand} sticker`,
      brand: `ZBR${rand}`,
      landmark: `LMK${rand} bench`,
    };
    const analysis = {
      is_valid_item: true,
      reject_reason: null,
      category: 'wallet',
      color: 'black',
      brand: secret.brand,
      public_title: `Black wallet ${secret.title}`,
      hidden_details: [{ detail: secret.detail, weight: 3 }],
      verifiability: 'high',
      is_valuable: true,
    };
    const foundFields = (over: Record<string, string> = {}) => ({
      buildingId: BUILDING,
      landmark: secret.landmark,
      foundAt: new Date().toISOString(),
      analysis: JSON.stringify(analysis),
      returnMethod: 'desk',
      ...over,
    });

    // ---- 1. buildings ----
    const br = await fetch(`${BASE}/api/buildings`);
    const bl: any = await br.json().catch(() => null);
    check('1 GET /api/buildings has zz-test', br.status === 200 && Array.isArray(bl) && bl.some((b: any) => b?.id === BUILDING), `${br.status}`);

    // ---- 2. no token ----
    const na = await post('/api/found/analyze', form({ buildingId: BUILDING }));
    check('2 analyze without token -> 401', na.status === 401, short(na));
    const nf = await post('/api/found', form(foundFields()));
    check('2 found without token -> 401', nf.status === 401, short(nf));

    // ---- 3. non-USC ----
    const xa = await post('/api/found/analyze', form({ buildingId: BUILDING }), other);
    check('3 analyze non-USC -> 403', xa.status === 403, short(xa));
    const xRow = await service.from('users').select('id').eq('id', ids[otherEmail]);
    check('3 non-USC has no users row', !xRow.error && (xRow.data?.length ?? 0) === 0, xRow.error?.message ?? `${xRow.data?.length} rows`);

    // ---- 3b. unconfirmed USC email ----
    {
      const email = `fo-check-${rand}-unconf@usc.edu`;
      const password = randomBytes(18).toString('base64url');
      const cu = await service.auth.admin.createUser({ email, password, email_confirm: false });
      if (cu.data.user) created.push(cu.data.user.id);
      const si = await createClient(url, anonKey, opts).auth.signInWithPassword({ email, password });
      // Auth refuses unconfirmed sign-in when "Confirm email" is on; if it ever issues a token, the server must still 403.
      const r = si.data.session ? await post('/api/found/analyze', form({ buildingId: BUILDING }), si.data.session.access_token) : null;
      check('3 unconfirmed USC email -> no session or 403', !cu.error && (r ? r.status === 403 : si.error?.code === 'email_not_confirmed'), cu.error?.message ?? (r ? short(r) : si.error?.code));
    }

    // ---- 4. analyze ----
    const an = await post('/api/found/analyze', form({ buildingId: BUILDING, landmark: secret.landmark }), usc);
    if (an.status === 503 && an.body?.error === 'ai_unavailable' && Object.keys(an.body).length === 1) {
      console.log('ok 4 analyze -> 503 ai_unavailable (note: AI down, manual-fields fallback)');
    } else {
      const missingKeys = ANALYSIS_KEYS.filter((k) => !(an.body && k in an.body));
      check('4 analyze -> 200 PhotoAnalysis', an.status === 200 && missingKeys.length === 0, an.status === 200 ? `missing ${missingKeys.join(',')}` : short(an));
    }

    // ---- 5. bad building ----
    const ba = await post('/api/found/analyze', form({ buildingId: 'nope-xyz' }), usc);
    check('5 analyze bad buildingId -> 400', ba.status === 400, short(ba));
    const bf = await post('/api/found', form(foundFields({ buildingId: 'nope-xyz' })), usc);
    check('5 found bad buildingId -> 400', bf.status === 400, short(bf));

    // ---- 6. found, desk ----
    const fd = await post('/api/found', form(foundFields()), usc);
    const item = fd.body?.item;
    check('6 found desk -> 200', fd.status === 200 && !!item, short(fd));
    let itemId = '';
    if (item) {
      itemId = item.id;
      check('6 item_code FO-####', /^FO-\d{4}$/.test(item.item_code ?? ''), `${item.item_code}`);
      check('6 status en_route_to_desk', item.status === 'en_route_to_desk', `${item.status}`);
      const keys = Object.keys(item).sort();
      check('6 keys == PublicFoundItem', JSON.stringify(keys) === JSON.stringify(PUBLIC_KEYS), keys.join(','));
      const banned: [string, string][] = [
        ['hidden_details', 'hidden_details'], ['photo_paths', 'photo_paths'], ['blurred_thumb_path', 'blurred_thumb_path'],
        ['finder_id', 'finder_id'], ['brand', 'brand'], ['landmark', 'landmark'], ['detail text', secret.detail],
        ['brand text', secret.brand], ['landmark text', secret.landmark], ['spoofed title', secret.title],
        ['user email', uscEmail], ['user id', uscId],
      ];
      const leaks = banned.filter(([, s]) => fd.text.includes(s)).map(([label]) => label);
      check('6 response leaks nothing private', leaks.length === 0, `contains ${leaks.join(', ')}`);
    }

    // ---- 7. DB row ----
    if (itemId) {
      const { data: row, error } = await service.from('found_items').select('*').eq('id', itemId).single();
      check('7 db row exists', !error && !!row, error?.message);
      if (row) {
        check('7 public_title rebuilt', !row.public_title.includes(secret.title) && row.public_title.includes(BUILDING), 'title not rebuilt from category/color/building');
        check('7 verifiability low (1 hidden detail)', row.verifiability === 'low', `${row.verifiability}`);
        check('7 finder_id is the USC user', row.finder_id === uscId, 'finder_id mismatch');

        // ---- 9. EXIF stripped ----
        for (const [label, p] of [['full photo', row.photo_paths?.[0]], ['blurred thumb', row.blurred_thumb_path]] as const) {
          const dl = p ? await service.storage.from('photos').download(p) : null;
          if (!dl?.data) {
            check(`9 download ${label}`, false, dl?.error?.message ?? 'no path');
            continue;
          }
          const m = await sharp(Buffer.from(await dl.data.arrayBuffer())).metadata();
          check(`9 ${label} has no EXIF`, m.exif === undefined, 'EXIF still present');
        }

        // ---- 10. thumb signed URL works; full photo not public ----
        const tr = await fetch(new URL(item.blurred_thumb_url, BASE));
        check('10 blurred_thumb_url -> 200', tr.status === 200, `${tr.status}`);
        const pr = await fetch(`${url}/storage/v1/object/public/photos/${row.photo_paths?.[0]}`);
        check('10 unsigned full photo URL not 200', pr.status !== 200, `${pr.status}`);
      }
    }

    // ---- 8. found, finder-held ----
    const ff = await post('/api/found', form(foundFields({ returnMethod: 'finder', availability: 'weekdays 2-4pm' })), usc);
    check('8 found finder -> 200 with_finder', ff.status === 200 && ff.body?.item?.status === 'with_finder', short(ff));
    if (ff.body?.item?.id) {
      const { data: row } = await service.from('found_items').select('held_at_desk_id, finder_availability').eq('id', ff.body.item.id).single();
      check('8 db held_at_desk_id null', row?.held_at_desk_id === null, `${row?.held_at_desk_id}`);
      check('8 db finder_availability stored', row?.finder_availability === 'weekdays 2-4pm', `${row?.finder_availability}`);
    }

    // ---- 11. flagged ----
    const fl = await service.from('users').update({ flagged: true }).eq('id', uscId).select('id');
    check('11 setup flag USC user', !fl.error && (fl.data?.length ?? 0) === 1, fl.error?.message ?? 'no users row (server did not create it)');
    const gf = await post('/api/found', form(foundFields()), usc);
    check('11 flagged found -> 403', gf.status === 403, short(gf));
    const ga = await post('/api/found/analyze', form({ buildingId: BUILDING }), usc);
    check('11 flagged analyze -> 403', ga.status === 403, short(ga));
  } finally {
    // ---- Cleanup: each step independent ----
    if (uscId) {
      try {
        await purgeFinder(service, uscId);
      } catch (e) {
        console.log(`cleanup found_items failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    try {
      await service.from('buildings').delete().eq('id', BUILDING);
    } catch (e) {
      console.log(`cleanup building failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const id of created) {
      try {
        // public.users cascades from auth.users
        await service.auth.admin.deleteUser(id);
      } catch (e) {
        console.log(`cleanup auth user failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  console.log(failed ? `${failed} checks failed` : 'B checks passed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('FAIL unexpected error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
