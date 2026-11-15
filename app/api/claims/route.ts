// Person 2: start a claim, return questions only. Contract: Team Tasks > API routes.
import { ClaimBody, badRequest, error, json } from '@/lib/api';
import { generateQuestions } from '@/lib/ai';
import { canClaim, claimFlags, genericQuestions, safeQuestions, type ClaimRow } from '@/lib/db';
import { requireUser } from '@/lib/supabase/auth';
import { supabaseAdmin } from '@/lib/supabase/server';
import type { ClaimStatus, FoundItemRow, LostReportRow, Question } from '@/types';

const FAIL = () => error('Something went wrong. Try again.', 500);
const DAY_MS = 24 * 60 * 60 * 1000;

// Field by field: nothing else stored with a question reaches the browser.
const copy = (q: Question): Question => ({ id: q.id, question: q.question, ...(q.hint && { hint: q.hint }), detail_indexes: q.detail_indexes });

export async function POST(req: Request) {
  try {
    const me = await requireUser(req, { write: true });
    if (me instanceof Response) return me;

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return error('Invalid JSON', 400);
    }
    const body = ClaimBody.safeParse(raw);
    if (!body.success) return badRequest(body.error);
    const { foundItemId, lostReportId } = body.data;

    const db = supabaseAdmin();
    const it = await db.from('found_items').select('*').eq('id', foundItemId).maybeSingle();
    if (it.error) return FAIL();
    const item = it.data as FoundItemRow | null;
    if (!item) return error('Item not found', 404);

    const lr = await db.from('lost_reports').select('*').eq('id', lostReportId).eq('owner_id', me.id).maybeSingle();
    if (lr.error) return FAIL();
    const report = lr.data as LostReportRow | null;

    // A repeat tap while answers are pending gets the same claim back.
    const pending = await db
      .from('claims')
      .select('id, questions')
      .eq('found_item_id', item.id)
      .eq('claimant_id', me.id)
      .eq('status', 'awaiting_answers')
      .limit(1)
      .maybeSingle();
    if (pending.error) return FAIL();
    if (pending.data) {
      const p = pending.data as Pick<ClaimRow, 'id' | 'questions'>;
      return json({ claimId: p.id, questions: (p.questions ?? []).map(copy) });
    }

    const now = new Date();
    // shortcut: read-then-write, two parallel requests can both pass the 3-per-day limit; move to a DB constraint if abused
    const recent = await db
      .from('claims')
      .select('id', { count: 'exact', head: true })
      .eq('claimant_id', me.id)
      .gte('created_at', new Date(now.getTime() - DAY_MS).toISOString());
    if (recent.error) return FAIL();

    const prior = await db
      .from('claims')
      .select('status, created_at')
      .eq('found_item_id', item.id)
      .eq('claimant_id', me.id)
      .order('created_at', { ascending: false });
    if (prior.error) return FAIL();
    const attempts = (prior.data ?? []) as { status: ClaimStatus; created_at: string }[];

    const can = canClaim({
      isFinder: item.finder_id === me.id,
      lostReport: report,
      claimsLast24h: recent.count ?? 0,
      priorAttempts: { count: attempts.length, lastStatus: attempts[0]?.status ?? null, lastAt: attempts[0]?.created_at ?? null },
      itemStatus: item.status,
      now,
    });
    if (!can.ok) return error(can.reason, can.status);
    const flags = claimFlags(item, report!); // canClaim ok means the report exists and is open

    const hidden = item.hidden_details ?? [];
    let questions: Question[] | null = null;
    if (hidden.length) {
      try {
        // One regenerate if the first set leaked or was unusable.
        for (let i = 0; i < 2 && !questions; i++) questions = safeQuestions(await generateQuestions({ hidden }), item);
      } catch {
        console.warn('generateQuestions failed, using generic question');
      }
    }
    questions ??= genericQuestions(hidden.length);

    const ins = await db
      .from('claims')
      .insert({
        found_item_id: item.id,
        lost_report_id: report!.id,
        claimant_id: me.id,
        questions,
        flags,
        status: 'awaiting_answers',
        attempt_no: can.attemptNo,
      })
      .select('id')
      .single();
    if (ins.error?.code === '23505') return error('You already have a claim on this item.', 409);
    if (ins.error) return FAIL();

    return json({ claimId: ins.data.id, questions: questions.map(copy) });
  } catch {
    return FAIL();
  }
}
