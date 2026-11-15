// Person 2: grade answers, compute score, set status. Contract: Team Tasks > API routes.
import { AnswersBody, IdParam, badRequest, error, json } from '@/lib/api';
import { computeScore, gradeAnswers } from '@/lib/ai';
import { PASSED_CLAIM, isPrefiled, notify, reviewerIds, setClaimPassed, type ClaimRow } from '@/lib/db';
import { requireUser } from '@/lib/supabase/auth';
import { supabaseAdmin } from '@/lib/supabase/server';
import type { FoundItemRow, LostReportRow, ScoreResult } from '@/types';

type Outcome = ScoreResult['outcome'];

const FAIL = () => error('Something went wrong. Try again.', 500);
const NOT_FOUND = () => error('Claim not found', 404);
const CONFLICT = () => error('This claim was already answered.', 409);
const OUTCOMES: Outcome[] = ['likely_owner', 'needs_review', 'rejected'];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser(req, { write: true });
    if (me instanceof Response) return me;

    const { id } = await ctx.params;
    if (!IdParam.safeParse({ id }).success) return NOT_FOUND();

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return error('Invalid JSON', 400);
    }
    const body = AnswersBody.safeParse(raw);
    if (!body.success) return badRequest(body.error);
    const answers = body.data.answers;

    const db = supabaseAdmin();
    const c = await db.from('claims').select('*').eq('id', id).maybeSingle();
    if (c.error) return FAIL();
    const claim = c.data as ClaimRow | null;
    if (!claim || claim.claimant_id !== me.id) return NOT_FOUND();
    if (claim.status !== 'awaiting_answers') return CONFLICT();

    const questions = claim.questions ?? [];
    const asked = new Set(questions.map((q) => q.id));
    const given = new Set(answers.map((a) => a.question_id));
    if (answers.length !== questions.length || given.size !== answers.length || ![...given].every((q) => asked.has(q))) {
      return error('Answer each question once.', 400);
    }

    const it = await db.from('found_items').select('*').eq('id', claim.found_item_id).maybeSingle();
    if (it.error) return FAIL();
    const item = it.data as FoundItemRow | null;
    if (!item) return NOT_FOUND();
    if (item.status === 'returned' || item.status === 'unclaimed') return error('This item is no longer available to claim.', 409);

    const hidden = item.hidden_details ?? [];
    let status: Outcome = 'needs_review';
    let score: number | null = null;
    let reason = 'A person will review your answers.';

    // Zero hidden details: nothing to grade, a person decides.
    if (hidden.length) {
      const lr = await db.from('lost_reports').select('raw_text, created_at').eq('id', claim.lost_report_id).maybeSingle();
      if (lr.error) return FAIL();
      const report = lr.data as Pick<LostReportRow, 'raw_text' | 'created_at'> | null;

      let prefiledMatch = false;
      if (report && isPrefiled(report, item)) {
        const m = await db.from('matches').select('id').eq('lost_report_id', claim.lost_report_id).eq('found_item_id', item.id).limit(1);
        if (m.error) return FAIL();
        prefiledMatch = (m.data ?? []).length > 0;
      }

      try {
        // Answers are untrusted user text; P3 passes them to Claude as data only.
        const grade = await gradeAnswers({ hidden, questions, answers, lostReportText: report?.raw_text ?? '' });
        const s = computeScore({ hidden, questions, grade, prefiledMatch, flags: claim.flags ?? [] });
        const n = Number(s.score);
        if (Number.isFinite(n) && OUTCOMES.includes(s.outcome)) {
          status = s.outcome;
          score = Math.min(100, Math.max(0, Math.round(n)));
          reason = String(grade.reason ?? '').trim().slice(0, 500) || reason;
        }
      } catch {
        console.warn('grading failed, sending claim to review');
      }
    }
    // Flagged claims always go to a person, whatever the score (spec wins over Team Tasks here).
    if ((claim.flags ?? []).length) status = 'needs_review';

    const title = item.public_title;
    const link = `/claims/${id}`;

    if (status === 'likely_owner') {
      const pickupCode = await setClaimPassed(id, 'awaiting_answers', 'likely_owner', { answers, score, reason });
      if (!pickupCode) return CONFLICT();

      // Two-pass rule: written first, then checked, so two parallel passes both see each other.
      const o = await db.from('claims').select('id, claimant_id').eq('found_item_id', item.id).neq('id', id).in('status', PASSED_CLAIM);
      if (o.error) return FAIL();
      const others = (o.data ?? []) as Pick<ClaimRow, 'id' | 'claimant_id'>[];
      if (others.length) {
        const u = await db
          .from('claims')
          .update({ status: 'needs_review', pickup_code: null })
          .in('id', [id, ...others.map((x) => x.id)])
          .in('status', PASSED_CLAIM);
        if (u.error) return FAIL();
        for (const x of others) {
          await notify([x.claimant_id], `Your claim on ${title} needs a review because someone else also matched.`, `/claims/${x.id}`);
        }
        await notify(await reviewerIds(item), `Two people matched ${title}. Please review their claims.`, link);
        return json({ status: 'needs_review' });
      }

      if (item.return_method === 'finder') await notify([item.finder_id], `Someone looks like the owner of ${title}. Chat is open.`, link);
      return json({ status: 'likely_owner', pickupCode });
    }

    const u = await db
      .from('claims')
      .update({ answers, score, reason, status })
      .eq('id', id)
      .eq('status', 'awaiting_answers')
      .select('id');
    if (u.error) return FAIL();
    if (!u.data?.length) return CONFLICT();

    if (status === 'needs_review') await notify(await reviewerIds(item), `A claim on ${title} needs your review.`, link);
    return json({ status });
  } catch {
    return FAIL();
  }
}
