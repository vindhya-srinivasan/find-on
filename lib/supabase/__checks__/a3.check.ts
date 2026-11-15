// Run after applying 0001_init.sql: npx tsx lib/supabase/__checks__/a3.check.ts
import { createClient } from '@supabase/supabase-js';

type PgErr = { code?: string; message?: string } | null;

let failed = 0;
function check(label: string, pass: boolean, detail?: string) {
  if (!pass) failed++;
  console.log(pass ? `ok ${label}` : `FAIL ${label}${detail ? `: ${detail}` : ''}`);
}
const why = (e: PgErr) => (e ? `${e.code ?? ''} ${e.message ?? ''}`.trim() : 'no error');

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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, opts);
  const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, opts);

  for (const t of ['buildings', 'desks']) {
    const { error } = await anon.from(t).select('id').limit(1);
    check(`anon read ${t}`, !error, why(error));
  }

  for (const t of ['found_items', 'claims', 'lost_reports', 'users']) {
    // Only a grant-level 42501 proves the lock; "0 rows" would also pass on an empty, open table.
    const { data, error } = await anon.from(t).select('id').limit(1);
    check(`anon blocked ${t}`, error?.code === '42501', error ? why(error) : `no error, ${data?.length ?? 0} rows visible`);
  }

  const ins = await anon.from('found_items').insert({ item_code: 'FO-0000' });
  check(
    'anon insert found_items denied',
    ins.error?.code === '42501',
    !ins.error
      ? "insert succeeded; run: delete from found_items where item_code = 'FO-0000'"
      : ins.error.code === '23502'
        ? `grant layer let anon through (${why(ins.error)})`
        : why(ins.error),
  );

  const all = ['buildings', 'desks', 'users', 'found_items', 'lost_reports', 'matches', 'claims', 'messages', 'abuse_reports', 'notifications'];
  for (const t of all) {
    const { error } = await service.from(t).select('id').limit(1);
    check(`service read ${t}`, !error, why(error));
  }

  const bucket = await service.storage.getBucket('photos');
  check(
    'storage photos bucket private',
    !bucket.error && bucket.data?.public === false,
    bucket.error ? bucket.error.message : `public=${bucket.data?.public}`,
  );

  console.log(failed ? `${failed} checks failed` : 'A3 checks passed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('FAIL unexpected error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
