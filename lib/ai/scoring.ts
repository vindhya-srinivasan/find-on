// Person 3: plain-code scoring (no AI). STUB until Person 3 implements the spec's Scoring logic.
import type { ClaimFlag, GradeResult, HiddenDetail, Question, ScoreResult } from '@/types';

export function computeScore(_input: {
  hidden: HiddenDetail[];
  questions: Question[];
  grade: GradeResult;
  prefiledMatch: boolean;
  flags: ClaimFlag[];
}): ScoreResult {
  return { score: 80, high_detail_matched: true, outcome: 'likely_owner' };
}
