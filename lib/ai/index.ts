// Person 3 — AI functions. STUBS: each returns a fixed sample of the right type so Person 2 can build now.
// Person 3 replaces each body with the real Claude call. Do not change the signatures (Team Tasks > AI functions).
import 'server-only';
import type {
  GradeResult, HiddenDetail, MatchResult, ParsedLostReport, PhotoAnalysis, Question,
} from '@/types';

export async function analyzePhoto(_input: {
  images: { base64: string; mediaType: string }[];
  buildingName: string;
  landmark?: string;
}): Promise<PhotoAnalysis> {
  return {
    is_valid_item: true, reject_reason: null,
    category: 'water bottle', color: 'black', brand: 'Hydro Flask',
    public_title: `Black water bottle · ${_input.buildingName}`,
    hidden_details: [
      { detail: 'Hydro Flask, about 32 oz', weight: 2 },
      { detail: 'White "Fight On" sticker near the bottom', weight: 3 },
      { detail: 'Dent on one side', weight: 3 },
      { detail: 'Green straw lid', weight: 2 },
    ],
    verifiability: 'high', is_valuable: false,
  };
}

export async function parseLostReport(input: { text: string; now: string }): Promise<ParsedLostReport> {
  const end = new Date(input.now);
  const start = new Date(end.getTime() - 7 * 24 * 3600 * 1000);
  return {
    category: 'water bottle', color: 'grey', brand: 'Hydro Flask', marks: ['pink sticker'],
    time_start: start.toISOString(), time_end: end.toISOString(),
    summary: input.text.slice(0, 140),
  };
}

export async function rankMatches(input: {
  lost: { summary: string; category: string; color: string | null; brand: string | null; marks: string[]; buildingNames: string[] };
  candidates: { id: string; category: string; color: string; brand: string | null; hidden_details: HiddenDetail[]; buildingName: string; found_at: string }[];
}): Promise<MatchResult[]> {
  return input.candidates.slice(0, 3).map((c) => ({
    candidate_id: c.id, score: 75,
    public_reason: `Same category (${c.category}), found at ${c.buildingName} within your time window`,
  }));
}

export async function generateQuestions(_input: { hidden: HiddenDetail[] }): Promise<Question[]> {
  return [
    { id: 'q1', question: 'What brand is it, and roughly what size?', detail_indexes: [0] },
    { id: 'q2', question: 'Describe any stickers, dents or marks on it.', detail_indexes: [1, 2] },
    { id: 'q3', question: 'What kind of lid does it have, and what color?', detail_indexes: [3] },
  ];
}

export async function gradeAnswers(_input: {
  hidden: HiddenDetail[];
  questions: Question[];
  answers: { question_id: string; answer: string }[];
  lostReportText: string;
}): Promise<GradeResult> {
  return {
    per_detail: _input.hidden.map((_, i) => ({ detail_index: i, verdict: 'match' as const })),
    reason: 'STUB: all details matched',
  };
}

export { computeScore } from './scoring';
