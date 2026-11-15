// Person 2: campus buildings from the `buildings` table (public campus data, no auth).
import 'server-only';
import { connection } from 'next/server';
import { json, error } from '@/lib/api';
import { supabaseAdmin } from '@/lib/supabase/server';
import type { Building } from '@/types';

export async function GET() {
  await connection();
  const { data, error: dbError } = await supabaseAdmin()
    .from('buildings')
    .select('id, name, lat, lng, type')
    .order('name', { ascending: true });
  if (dbError) return error('Could not load buildings.', 500);
  return json((data ?? []) as Building[]);
}
