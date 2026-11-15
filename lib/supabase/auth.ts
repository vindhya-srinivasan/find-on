// Person 2: who is calling an API route. Verifies the token with Supabase Auth and ensures a users row.
import 'server-only';
import type { User } from '@supabase/supabase-js';
import { error } from '@/lib/api';
import { isUscEmail, supabaseAdmin, supabaseServer } from '@/lib/supabase/server';
import type { Role } from '@/types';

export type AuthedUser = { id: string; email: string; role: Role; desk_id: string | null; flagged: boolean };

const COLS = 'id, email, role, desk_id, flagged';
const FAIL = () => error('Something went wrong. Try again.', 500);

/** Usage: `const me = await requireUser(req, { write: true }); if (me instanceof Response) return me;` */
export async function requireUser(req: Request, opts?: { write?: boolean }): Promise<AuthedUser | Response> {
  const user = await verify(req);
  if (!user) return error('Sign in to continue.', 401);
  // Gate before any DB write so a non-USC account never gets a users row.
  if (!isUscEmail(user.email)) return error('Only @usc.edu accounts can use FindOn.', 403);
  // Only a confirmed email proves the caller owns that @usc.edu inbox.
  if (!user.email_confirmed_at) return error('Please verify your @usc.edu email.', 403);

  const db = supabaseAdmin();
  let { data, error: selErr } = await db.from('users').select(COLS).eq('id', user.id).maybeSingle();
  if (selErr) return FAIL();
  if (!data) {
    // Insert, not upsert: an upsert would reset a seeded desk role or a flag.
    const { first_name, last_initial } = nameFrom(user.user_metadata);
    const ins = await db
      .from('users')
      .insert({ id: user.id, email: user.email!.toLowerCase(), first_name, last_initial })
      .select(COLS)
      .single();
    if (ins.error?.code === '23505') {
      // Another request created the row first.
      ({ data, error: selErr } = await db.from('users').select(COLS).eq('id', user.id).maybeSingle());
      if (selErr || !data) return FAIL();
    } else if (ins.error) {
      return FAIL();
    } else {
      data = ins.data;
    }
  }

  const me = data as AuthedUser;
  if (opts?.write && me.flagged) return error('Your account is paused pending review.', 403);
  return me;
}

/** Bearer header (scripts) wins; otherwise the @supabase/ssr cookie session. getUser() checks with the Auth server. */
async function verify(req: Request): Promise<User | null> {
  const header = req.headers.get('authorization');
  if (header) {
    const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    if (!token) return null;
    const { data, error: e } = await supabaseAdmin().auth.getUser(token);
    return e ? null : data.user;
  }
  const { data, error: e } = await (await supabaseServer()).auth.getUser();
  return e ? null : data.user;
}

/** Never derive from the email: it would leak the NetID. */
function nameFrom(meta: Record<string, unknown> | undefined) {
  const first = typeof meta?.first_name === 'string' ? meta.first_name.trim().slice(0, 40) : '';
  const initial = typeof meta?.last_initial === 'string' ? meta.last_initial.trim().charAt(0).toUpperCase() : '';
  return { first_name: first || 'Trojan', last_initial: /^\p{L}$/u.test(initial) ? initial : '' };
}
