// Person 3: plain-code scoring (no AI). Spec > Scoring logic. Claude never outputs the score.
import type { ClaimFlag, GradeResult, HiddenDetail, Question, ScoreResult, Verdict } from '@/types';

const CREDIT: Record<Verdict, number> = { match: 1, partial: 0.5, not_mentioned: 0, contradicts: -1 };

export function computeScore(input: {
  hidden: HiddenDetail[];
  questions: Question[];
  grade: GradeResult;
  prefiledMatch: boolean;
  flags: ClaimFlag[];
}): ScoreResult {
  // Details the questions actually asked about (deduped, only valid indexes).
  const covered = new Set<number>();
  for (const q of input.questions) {
    for (const i of q.detail_indexes) if (Number.isInteger(i) && i >= 0 && i < input.hidden.length) covered.add(i);
  }

  // One verdict per detail; anything Claude skipped counts as not_mentioned. First verdict wins on duplicates.
  const verdicts = new Map<number, Verdict>();
  for (const v of input.grade.per_detail) {
    if (covered.has(v.detail_index) && !verdicts.has(v.detail_index) && v.verdict in CREDIT) {
      verdicts.set(v.detail_index, v.verdict);
    }
  }

  let possible = 0;
  let earned = 0;
  let highMatched = false;
  for (const i of covered) {
    const w = input.hidden[i].weight;
    const verdict = verdicts.get(i) ?? 'not_mentioned';
    possible += w;
    earned += CREDIT[verdict] * w;
    if (w === 3 && verdict === 'match') highMatched = true;
  }

  // Nothing to verify against → can't auto-pass; a human decides.
  if (possible === 0) return { score: 0, high_detail_matched: false, outcome: 'needs_review' };

  let score = Math.max(0, (earned / possible) * 100);
  if (input.prefiledMatch) score += 10;
  score = Math.round(Math.min(100, Math.max(0, score)));

  let outcome: ScoreResult['outcome'];
  if (score < 40) outcome = 'rejected';
  else if (score >= 70 && highMatched) outcome = 'likely_owner';
  else outcome = 'needs_review';

  // filed_after_listing / low_verifiability → always human review (unless already rejected).
  if (input.flags.length > 0 && outcome === 'likely_owner') outcome = 'needs_review';

  return { score, high_detail_matched: highMatched, outcome };
}
