// Person 3: "Can you fake a claim?" Tuning game for verification (Team Tasks P3 task 11).
// Uses the real analyzePhoto → generateQuestions → gradeAnswers → computeScore, no database, no login.
//
//   npx tsx --conditions=react-server scripts/guess-game.mts          humans play at the keyboard
//   npx tsx --conditions=react-server scripts/guess-game.mts --bots   Claude plays 3 guessers + 1 owner per item
//   add --requestion to regenerate the questions (keeps the cached photo analysis) after a prompt change
//
// Items = photos in data/seed/photos/. Each photo is analyzed once and cached, so every player gets the
// same questions. Every attempt is appended to a log for tuning (path printed at the end).
import { existsSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { z } from 'zod';
import type { HiddenDetail, PhotoAnalysis, Question } from '@/types';

try { process.loadEnvFile('.env.local'); } catch { /* env from shell */ }
const ai = await import('@/lib/ai');
const { callJson } = await import('@/lib/ai/client');

const DIR = path.resolve('data/seed/photos');
const CACHE = path.join(tmpdir(), 'findon-guess-cache.json');
const LOG = path.join(tmpdir(), 'findon-guess-log.jsonl');
const BUILDINGS = ['Taper Hall', 'Leavey Library', 'Doheny Memorial Library', 'Salvatori Computer Science Center', 'USC Village'];

type Item = { file: string; analysis: PhotoAnalysis; questions: Question[] };

// ---------- items ----------
async function loadItems(): Promise<Item[]> {
  const cache: Record<string, Item> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
  const files = readdirSync(DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
  const items: Item[] = [];
  for (const [n, file] of files.entries()) {
    if (!cache[file]) {
      process.stdout.write(`Preparing ${file}… `);
      const ext = path.extname(file).slice(1).toLowerCase();
      const analysis = await ai.analyzePhoto({
        images: [{ base64: readFileSync(path.join(DIR, file)).toString('base64'), mediaType: `image/${ext === 'jpg' ? 'jpeg' : ext}` }],
        buildingName: BUILDINGS[n % BUILDINGS.length],
      });
      const questions = analysis.is_valid_item ? await ai.generateQuestions({ hidden: analysis.hidden_details }) : [];
      cache[file] = { file, analysis, questions };
      writeFileSync(CACHE, JSON.stringify(cache, null, 2));
      console.log('done');
    }
    if (process.argv.includes('--requestion') && cache[file].analysis.is_valid_item) {
      cache[file].questions = await ai.generateQuestions({ hidden: cache[file].analysis.hidden_details });
      writeFileSync(CACHE, JSON.stringify(cache, null, 2));
    }
    if (cache[file].analysis.is_valid_item) items.push(cache[file]);
  }
  return items;
}

// ---------- grading ----------
type Attempt = { player: string; role: 'owner' | 'guesser'; item: string; lostText: string; answers: string[] };
async function grade(item: Item, a: Attempt) {
  const hidden = item.analysis.hidden_details;
  const g = await ai.gradeAnswers({
    hidden, questions: item.questions, lostReportText: a.lostText,
    answers: item.questions.map((q, i) => ({ question_id: q.id, answer: a.answers[i] || "I don't know" })),
  });
  const flags = item.analysis.verifiability === 'low' ? (['low_verifiability'] as const) : [];
  const s = ai.computeScore({ hidden, questions: item.questions, grade: g, prefiledMatch: false, flags: [...flags] });
  appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...a, score: s.score, outcome: s.outcome, verdicts: g.per_detail, reason: g.reason }) + '\n');
  return { g, s };
}

const ICON = { likely_owner: '🟢 LIKELY OWNER (pickup code issued)', needs_review: '🟡 NEEDS REVIEW (a human decides)', rejected: '🔴 REJECTED' };
function report(item: Item, r: Awaited<ReturnType<typeof grade>>, reveal: boolean) {
  console.log(`\n   ${ICON[r.s.outcome]}  score ${r.s.score}/100`);
  if (!reveal) return;
  console.log('   What the item really has (hidden from claimants):');
  for (const v of r.g.per_detail) {
    const d: HiddenDetail = item.analysis.hidden_details[v.detail_index];
    console.log(`     [w${d.weight}] ${d.detail}  →  ${v.verdict}`);
  }
  console.log(`   Grader: ${r.g.reason}`);
}

// ---------- humans ----------
async function humans(items: Item[]) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log('\n🎯  CAN YOU FAKE A CLAIM?  Try to claim items that are not yours. Real owners should pass; guessers should not.\n');
  const player = (await rl.question('Your name: ')).trim() || 'anon';
  for (;;) {
    console.log('\nFound items (this is all a claimant can see):');
    items.forEach((it, i) => console.log(`  ${i + 1}. ${it.analysis.public_title}${it.analysis.verifiability === 'low' ? '   (few marks → always human review)' : ''}`));
    const pick = (await rl.question('\nPick an item number (or q to quit): ')).trim();
    if (pick === 'q') break;
    const item = items[Number(pick) - 1];
    if (!item) continue;
    const role = (await rl.question('Have you seen this item / do you own it? (o = owner, g = guessing): ')).trim().toLowerCase().startsWith('o') ? 'owner' : 'guesser';
    const lostText = await rl.question('Describe what you lost, like on the lost form: ');
    const answers: string[] = [];
    for (const q of item.questions) {
      console.log(`\n  ❓ ${q.question}${q.hint ? `\n     ${q.hint}` : ''}`);
      answers.push(await rl.question('  > '));
    }
    process.stdout.write('\n   Grading…');
    const r = await grade(item, { player, role, item: item.file, lostText, answers });
    report(item, r, true);
  }
  rl.close();
}

// ---------- bots ----------
const BotSchema = z.object({ lost_text: z.string(), answers: z.array(z.string()) });
const BOTS = [
  { name: 'bot-vague', role: 'guesser' as const, style: 'Answer briefly and vaguely, the way someone who never saw the item would hedge.' },
  { name: 'bot-confident', role: 'guesser' as const, style: 'Answer confidently with specific, plausible details typical for this kind of item (common brands, typical stickers, usual colors). Commit to specifics.' },
  { name: 'bot-shotgun', role: 'guesser' as const, style: 'List many possibilities in each answer to cover all bases (e.g. "a sticker or a scratch or initials, maybe a keychain").' },
  { name: 'bot-owner', role: 'owner' as const, style: 'You ARE the real owner. Answer naturally in your own words, paraphrasing (not copying) the true details. Forget one minor detail, as real people do.' },
];

async function bots(items: Item[]) {
  for (const item of items) {
    console.log(`\n━━ ${item.analysis.public_title}  (${item.file}, verifiability ${item.analysis.verifiability})`);
    item.questions.forEach((q) => console.log(`   ❓ ${q.question}`));
    for (const bot of BOTS) {
      const knows = bot.role === 'owner'
        ? `The true details of your item:\n${item.analysis.hidden_details.map((d) => `- ${d.detail}`).join('\n')}`
        : `You only know the public listing: "${item.analysis.public_title}". You have never seen the item.`;
      const b = await callJson({
        task: 'guessBot',
        system: `You are role-playing a claimant in a lost-and-found ownership quiz, to test the system. ${bot.style}\nReturn lost_text (one sentence describing the item as on a lost form) and one answer per question, in order.`,
        content: `${knows}\n\nQuestions:\n${item.questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}`,
        schema: BotSchema,
      });
      const r = await grade(item, { player: bot.name, role: bot.role, item: item.file, lostText: b.lost_text, answers: b.answers });
      const ok = bot.role === 'owner' ? r.s.outcome !== 'rejected' : r.s.outcome !== 'likely_owner';
      console.log(`   ${ok ? '✅' : '❌'} ${bot.name.padEnd(13)} ${ICON[r.s.outcome].split(' (')[0].padEnd(16)} ${String(r.s.score).padStart(3)}  | ${b.answers.join(' / ').slice(0, 110)}`);
    }
  }
}

const items = await loadItems();
if (process.argv.includes('--bots')) await bots(items);
else await humans(items);
console.log(`\nLog: ${LOG}`);
