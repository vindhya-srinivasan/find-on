// Person 2: chat after a claim passes. Contract: Team Tasks > API routes.
import { connection } from 'next/server';
import { IdParam, MessageBody, badRequest, error, json } from '@/lib/api';
import { PASSED_CLAIM, displayName, inPersonCheck, notify, type ClaimRow } from '@/lib/db';
import { requireUser, type AuthedUser } from '@/lib/supabase/auth';
import { supabaseAdmin } from '@/lib/supabase/server';
import type { ChatMessage, FoundItemRow } from '@/types';

const FAIL = () => error('Something went wrong. Try again.', 500);
const NOT_FOUND = () => error('Claim not found', 404);

type Ctx = { params: Promise<{ id: string }> };
type Chat = { me: AuthedUser; claim: ClaimRow; item: FoundItemRow };

// Chat exists only for finder-held items, between the claimant and the finder, after the claim passes
// or while a borderline claim waits for an in-person check (inPersonCheck in lib/db.ts).
async function openChat(req: Request, ctx: Ctx, write: boolean): Promise<Chat | Response> {
  const me = await requireUser(req, { write });
  if (me instanceof Response) return me;

  const { id } = await ctx.params;
  if (!IdParam.safeParse({ id }).success) return NOT_FOUND();
  const db = supabaseAdmin();
  const c = await db.from('claims').select('*').eq('id', id).maybeSingle();
  if (c.error) return FAIL();
  const claim = c.data as ClaimRow | null;
  if (!claim) return NOT_FOUND();
  const i = await db.from('found_items').select('*').eq('id', claim.found_item_id).maybeSingle();
  if (i.error) return FAIL();
  const item = i.data as FoundItemRow | null;
  if (!item || item.return_method !== 'finder' || (me.id !== claim.claimant_id && me.id !== item.finder_id)) return NOT_FOUND();
  if (!PASSED_CLAIM.includes(claim.status) && !inPersonCheck(claim)) return error('Chat opens once the claim passes verification.', 409);
  return { me, claim, item };
}

async function listMessages({ me, claim, item }: Chat): Promise<ChatMessage[] | Response> {
  const db = supabaseAdmin();
  // shortcut: newest 200 messages only, paginate if chats get long
  const [m, u] = await Promise.all([
    db.from('messages').select('id, sender_id, body, created_at').eq('claim_id', claim.id).order('created_at', { ascending: false }).limit(200),
    db.from('users').select('id, first_name, last_initial').in('id', [claim.claimant_id, item.finder_id]),
  ]);
  if (m.error || u.error) return FAIL();
  const names = new Map((u.data ?? []).map((x) => [x.id as string, displayName(x)]));
  // Explicit copy: sender ids never leave the server.
  return (m.data ?? []).reverse().map((x) => ({
    id: x.id,
    body: x.body,
    created_at: x.created_at,
    mine: x.sender_id === me.id,
    sender_name: names.get(x.sender_id) ?? 'Someone',
  }));
}

const respond = (list: ChatMessage[] | Response) => (list instanceof Response ? list : json(list));

export async function GET(req: Request, ctx: Ctx) {
  await connection();
  try {
    const chat = await openChat(req, ctx, false);
    return chat instanceof Response ? chat : respond(await listMessages(chat));
  } catch {
    return FAIL();
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const chat = await openChat(req, ctx, true);
    if (chat instanceof Response) return chat;
    const raw = await req.json().catch(() => undefined);
    if (raw === undefined) return error('Invalid JSON', 400);
    const body = MessageBody.safeParse(raw);
    if (!body.success) return badRequest(body.error);

    const db = supabaseAdmin();
    const ins = await db.from('messages').insert({ claim_id: chat.claim.id, sender_id: chat.me.id, body: body.data.body });
    if (ins.error) return FAIL();

    // Tell the other person, but keep at most one unread chat alert per claim so a conversation doesn't spam them.
    const to = chat.me.id === chat.claim.claimant_id ? chat.item.finder_id : chat.claim.claimant_id;
    const link = `/claims/${chat.claim.id}`;
    const unread = await db.from('notifications').select('id').eq('user_id', to).eq('link', link).eq('read', false).like('text', 'New message%').limit(1);
    if (!unread.error && !(unread.data ?? []).length) await notify([to], `New message about ${chat.item.public_title}`, link);
    return respond(await listMessages(chat));
  } catch {
    return FAIL();
  }
}
