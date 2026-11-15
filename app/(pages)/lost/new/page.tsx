// Person 1: owner flow. One page: where (filled from location) + three short questions + when → optional photo → matches.
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Building } from '@/types';
import { api } from '@/lib/mock';
import { useBuildings } from '@/components/useBuildings';
import { useCurrentBuilding } from '@/components/useCurrentBuilding';
import { BuildingPicker } from '@/components/BuildingPicker';
import { PhotoInput } from '@/components/PhotoInput';
import { FlowBottomSpace, PrimaryAction, StepHeader, StickyAction } from '@/components/Flow';
import { ErrorText, Label, Spinner, inputClass } from '@/components/ui';

const TOTAL = 2;
const KINDS = ['Water bottle', 'Phone', 'Wallet', 'Keys', 'Backpack', 'Earbuds', 'Laptop', 'Jacket', 'ID card'];
const WHEN = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This week' },
  { id: 'unsure', label: 'Not sure' },
] as const;
type When = (typeof WHEN)[number]['id'];

/**
 * Questions 2 and 3 change with the item, so they always make sense.
 * a / b = the two answers in question 2, c = question 3. `need` = which of a/b must be filled.
 */
type Qs = {
  q2: string; aLabel: string; aPlaceholder: string; aChips?: string[];
  bLabel: string; bPlaceholder: string; bOptional: boolean; bPrivate?: boolean;
  q3: string; q3Hint: string; need: 'a' | 'ab' | 'none';
  sentence: (kind: string, a: string, b: string, c: string) => string;
};

const GENERIC: Qs = {
  q2: '2. Color and brand', aLabel: 'Main color', aPlaceholder: 'e.g. grey',
  bLabel: 'Brand', bPlaceholder: 'e.g. Hydro Flask', bOptional: true,
  q3: '3. Anything that makes it stand out?', q3Hint: 'e.g. a sticker, a case, a keychain, a scratch. Optional.', need: 'a',
  sentence: (k, a, b, c) => [`${a} ${b} ${k}`, c && `with ${c}`].filter(Boolean).join(' '),
};

const QUESTIONS: Record<string, Qs> = {
  'id card': {
    q2: '2. Which ID is it?', aLabel: 'Type of ID', aPlaceholder: 'e.g. USC ID', aChips: ['USC ID', 'Driver’s license', 'Passport', 'Other'],
    bLabel: 'Name on it', bPlaceholder: 'As printed on the card', bOptional: true, bPrivate: true,
    q3: '3. Was it in or on anything?', q3Hint: 'e.g. a lanyard, a card holder, a phone case. Optional.', need: 'a',
    sentence: (_k, a, b, c) => [`${a}`, b && `with the name ${b}`, c && `in ${c}`].filter(Boolean).join(' '),
  },
  phone: {
    ...GENERIC, q2: '2. Model and color', aLabel: 'Model', aPlaceholder: 'e.g. iPhone 15', bLabel: 'Color', bPlaceholder: 'e.g. blue', bOptional: true,
    q3: '3. Case or anything on it?', q3Hint: 'e.g. a clear case, a PopSocket, a cracked corner. Optional.',
    sentence: (k, a, b, c) => [`${b} ${a} ${k}`, c && `with ${c}`].filter(Boolean).join(' '),
  },
  laptop: {
    ...GENERIC, q2: '2. Model and color', aLabel: 'Model', aPlaceholder: 'e.g. MacBook Air', bLabel: 'Color', bPlaceholder: 'e.g. silver', bOptional: true,
    q3: '3. Stickers, case or sleeve?', q3Hint: 'e.g. stickers on the lid, a black sleeve. Optional.',
    sentence: (k, a, b, c) => [`${b} ${a} ${k}`, c && `with ${c}`].filter(Boolean).join(' '),
  },
  earbuds: {
    ...GENERIC, q2: '2. Model and case color', aLabel: 'Model', aPlaceholder: 'e.g. AirPods Pro', bLabel: 'Case color', bPlaceholder: 'e.g. white', bOptional: true,
    q3: '3. Anything on the case?', q3Hint: 'e.g. a cover, a keychain, an engraving. Optional.',
    sentence: (k, a, b, c) => [`${b} ${a} ${k}`, c && `with ${c}`].filter(Boolean).join(' '),
  },
  keys: {
    ...GENERIC, q2: '2. What’s on the key ring?', aLabel: 'Keychain or tag', aPlaceholder: 'e.g. Trojan keychain', bLabel: 'How many keys', bPlaceholder: 'e.g. 3', bOptional: true,
    q3: '3. Anything else attached?', q3Hint: 'e.g. a car fob, a bottle opener, a USC card. Optional.',
    sentence: (k, a, b, c) => [`${k}`, a && `on a ${a}`, b && `(${b} keys)`, c && `with ${c}`].filter(Boolean).join(' '),
  },
  wallet: {
    ...GENERIC, q3: '3. Anything that makes it stand out?', q3Hint: 'e.g. a zipper, initials, a worn corner. Optional.',
  },
};

// Typed items are matched by keyword, so "student ID", "iPhone 15" or "AirPods" get the right questions.
const MATCHERS: [RegExp, string][] = [
  [/\b(id|ids|i\.d\.?|identification|license|licence|passport|student card|usc card|ucard)\b/i, 'id card'],
  [/\b(wallet|purse|card ?holder|billfold)\b/i, 'wallet'],
  [/\b(phone|iphone|android|pixel|galaxy|cellphone|cell)\b/i, 'phone'],
  [/\b(laptop|macbook|chromebook|notebook computer|ipad|tablet|surface)\b/i, 'laptop'],
  [/\b(earbuds?|airpods?|headphones?|earphones?|beats|buds)\b/i, 'earbuds'],
  [/\b(keys?|keychain|key ?ring|key ?fob|car fob)\b/i, 'keys'],
];
const questionsFor = (kind: string) => {
  const t = kind.trim().toLowerCase();
  if (QUESTIONS[t]) return QUESTIONS[t];
  const hit = MATCHERS.find(([re]) => re.test(t));
  return hit ? QUESTIONS[hit[1]] : GENERIC;
};

const chip = (on: boolean) =>
  `min-h-11 rounded-full border px-4 text-sm font-medium ${on ? 'border-cardinal bg-red-50 text-cardinal' : 'border-neutral-300 bg-white text-neutral-800'}`;

const Pin = () => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-cardinal">
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
  </svg>
);

export default function LostNew() {
  const router = useRouter();
  const { buildings } = useBuildings();
  const { state: loc, locate } = useCurrentBuilding(buildings);
  const [step, setStep] = useState(1);

  // Where. Until the user edits the list, it is just where they are now.
  const [chosen, setChosen] = useState<Building[] | null>(null);
  const places = chosen ?? (loc.kind === 'found' ? [loc.building] : []);
  const [notSure, setNotSure] = useState(false);
  const [picker, setPicker] = useState<'replace' | 'add' | null>(null);

  // What.
  const [kind, setKind] = useState('');
  const [a, setA] = useState('');      // question 2, first answer
  const [b, setB] = useState('');      // question 2, second answer
  const [marks, setMarks] = useState(''); // question 3
  const qs = questionsFor(kind);
  // Picking a different kind of item clears answers that belonged to the old questions.
  function chooseKind(k: string) {
    if (questionsFor(k) !== qs) { setA(''); setB(''); }
    setKind(k);
  }
  const [when, setWhen] = useState<When>('unsure');

  const [photos, setPhotos] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ask for location as soon as the building list is ready.
  useEffect(() => { if (buildings.length) locate(); }, [buildings.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(b: Building) {
    if (picker === 'replace') setChosen([b, ...places.slice(1).filter((x) => x.id !== b.id)]);
    else setChosen(places.some((x) => x.id === b.id) ? places : [...places, b]);
    setNotSure(false);
    setPicker(null);
  }

  const whereDone = notSure || places.length > 0;
  const q2Done = qs.need === 'none' || (a.trim() !== '' && (qs.need === 'a' || b.trim() !== ''));
  const canContinue = whereDone && kind.trim() !== '' && q2Done;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      // One plain sentence for the AI to parse, plus the same answers as separate fields.
      const whenText = { today: 'Lost it today.', yesterday: 'Lost it yesterday.', week: 'Lost it this week.', unsure: '' }[when];
      const sentence = qs.sentence(kind.trim(), a.trim(), b.trim(), marks.trim()).replace(/\s+/g, ' ').trim();
      const text = `${sentence}. ${whenText}`.trimEnd();
      const isId = qs === QUESTIONS['id card'];
      form.append('text', text);
      form.append('category', kind.trim());
      const colorBrand = qs === GENERIC || qs === QUESTIONS.wallet ? { color: a, brand: b }
        : [QUESTIONS.phone, QUESTIONS.laptop, QUESTIONS.earbuds].includes(qs) ? { color: b, brand: a }
        : { color: '', brand: '' }; // ID cards and keys have no color/brand answers
      form.append('color', colorBrand.color.trim());
      form.append('brand', colorBrand.brand.trim());
      if (qs === QUESTIONS.keys) { form.append('keychain', a.trim()); form.append('key_count', b.trim()); }
      form.append('marks', marks.trim());
      if (isId) { form.append('id_type', a.trim()); form.append('id_name', b.trim()); }
      form.append('when', when);
      form.append('buildingIds', JSON.stringify(notSure ? [] : places.map((p) => p.id)));
      form.append('notSure', String(notSure));
      form.append('landmarks', JSON.stringify([]));
      if (photos[0]) form.append('photo', photos[0]);
      const res = await api.submitLost(form);
      sessionStorage.setItem(`lost:${res.reportId}`, JSON.stringify(res));
      router.push(`/lost/${res.reportId}`);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div>
      {step === 1 && (
        <>
          <StepHeader step={1} total={TOTAL} title="What did you lose?" help="Short answers are fine." />

          {/* Where: filled in from the phone's location as soon as permission is given. */}
          <section aria-label="Where you lost it" aria-live="polite" className="mb-7 rounded-[20px] bg-cream p-4">
            {notSure ? (
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-[15px]"><Pin /> Searching <span className="font-semibold">all of campus</span></p>
                <button type="button" onClick={() => setNotSure(false)} className="min-h-11 rounded-xl px-2 text-sm font-semibold text-cardinal">Change</button>
              </div>
            ) : places.length > 0 ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-2 text-[15px]">
                    <Pin /><span className="text-neutral-600">Lost near</span> <span className="truncate font-semibold">{places[0].name}</span>
                  </p>
                  <button type="button" onClick={() => setPicker('replace')} className="min-h-11 shrink-0 rounded-xl px-2 text-sm font-semibold text-cardinal">Change</button>
                </div>
                {places.length > 1 && (
                  <ul className="mt-1 flex flex-wrap gap-2" aria-label="Other places">
                    {places.slice(1).map((p) => (
                      <li key={p.id} className="flex min-h-10 items-center gap-1 rounded-full bg-white pl-3 pr-1 text-sm ring-1 ring-neutral-300">
                        {p.name}
                        <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setChosen(places.filter((x) => x.id !== p.id))}
                          className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100">
                          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex flex-wrap gap-x-4">
                  <button type="button" onClick={() => setPicker('add')} className="min-h-11 text-sm font-semibold text-neutral-800 underline-offset-4 hover:underline">+ Add another place</button>
                  <button type="button" onClick={() => setNotSure(true)} className="min-h-11 text-sm font-semibold text-neutral-800 underline-offset-4 hover:underline">Not sure where</button>
                </div>
              </>
            ) : loc.kind === 'locating' || loc.kind === 'idle' ? (
              <p role="status" className="flex min-h-11 items-center gap-2 text-[15px] text-neutral-700"><Spinner small /> Finding where you are…</p>
            ) : (
              <>
                <p className="text-[15px] text-neutral-700">
                  {loc.kind === 'off_campus' ? 'Looks like you’re off campus.' : loc.kind === 'failed' ? loc.reason : ''} Where did you last have it?
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4">
                  <button type="button" onClick={() => setPicker('add')} className="min-h-11 text-sm font-semibold text-cardinal">Pick a building</button>
                  <button type="button" onClick={() => setNotSure(true)} className="min-h-11 text-sm font-semibold text-neutral-800">Not sure where</button>
                </div>
              </>
            )}
          </section>

          <div className="flex flex-col gap-6">
            <div>
              <Label htmlFor="kind">1. What is it?</Label>
              <div className="mb-2 flex flex-wrap gap-2">
                {KINDS.map((k) => (
                  <button key={k} type="button" aria-pressed={kind === k} onClick={() => chooseKind(kind === k ? '' : k)} className={chip(kind === k)}>{k}</button>
                ))}
              </div>
              <input id="kind" value={kind} onChange={(e) => chooseKind(e.target.value)} placeholder="Or type it, e.g. umbrella" autoComplete="off" enterKeyHint="next" className={inputClass} />
            </div>

            <div>
              <p className="mb-2 text-[15px] font-semibold">{qs.q2}</p>
              {qs.aChips && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {qs.aChips.map((c) => (
                    <button key={c} type="button" aria-pressed={a === c} onClick={() => setA(a === c ? '' : c)} className={chip(a === c)}>{c}</button>
                  ))}
                </div>
              )}
              <div className={qs.aChips ? 'flex flex-col gap-3' : 'grid grid-cols-2 gap-3'}>
                <div>
                  <label htmlFor="q2a" className="mb-1 block text-sm text-neutral-700">{qs.aLabel}</label>
                  <input id="q2a" value={a} onChange={(e) => setA(e.target.value)} placeholder={qs.aPlaceholder} autoComplete="off" enterKeyHint="next" className={inputClass} />
                </div>
                <div>
                  <label htmlFor="q2b" className="mb-1 block text-sm text-neutral-700">
                    {qs.bLabel} {qs.bOptional && <span className="text-neutral-500">(optional)</span>}
                  </label>
                  <input id="q2b" value={b} onChange={(e) => setB(e.target.value)} placeholder={qs.bPlaceholder} autoComplete="off" enterKeyHint="next" className={inputClass}
                    aria-describedby={qs.bPrivate ? 'q2b-private' : undefined} />
                  {qs.bPrivate && (
                    <p id="q2b-private" className="mt-1 text-sm text-neutral-600">Kept private. Only used to match your ID, never shown to anyone.</p>
                  )}
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="marks" hint={qs.q3Hint}>{qs.q3}</Label>
              <input id="marks" value={marks} onChange={(e) => setMarks(e.target.value)} placeholder="Type one or two details" autoComplete="off" enterKeyHint="done" className={inputClass} />
              <p className="mt-2 text-sm text-neutral-600">Tip: keep one detail to yourself. You may be asked about it to prove it&apos;s yours.</p>
            </div>

            <fieldset>
              <legend className="mb-2 text-[15px] font-semibold">When did you last have it?</legend>
              <div className="flex flex-wrap gap-2">
                {WHEN.map((w) => (
                  <button key={w.id} type="button" aria-pressed={when === w.id} onClick={() => setWhen(w.id)} className={chip(when === w.id)}>{w.label}</button>
                ))}
              </div>
            </fieldset>
          </div>

          {picker && (
            <BuildingPicker buildings={buildings} title={picker === 'replace' ? 'Where did you lose it?' : 'Add a place'} onClose={() => setPicker(null)} onPick={pick} />
          )}
          <FlowBottomSpace />
          <StickyAction>
            <PrimaryAction disabled={!canContinue} onClick={() => setStep(2)}>Next</PrimaryAction>
          </StickyAction>
        </>
      )}

      {step === 2 && (
        <>
          <StepHeader step={2} total={TOTAL} title="Have a photo of it?" help="Optional. An old photo from your camera roll helps prove it's yours." onBack={() => setStep(1)} />
          <PhotoInput files={photos} onChange={setPhotos} max={1} required={false} />
          <div className="mt-3"><ErrorText error={error} /></div>
          <FlowBottomSpace />
          <StickyAction>
            <PrimaryAction loading={submitting} onClick={submit}>{photos.length ? 'Find my item' : 'Skip and find my item'}</PrimaryAction>
          </StickyAction>
        </>
      )}
    </div>
  );
}
