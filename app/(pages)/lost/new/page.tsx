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
  const [color, setColor] = useState('');
  const [brand, setBrand] = useState('');
  const [marks, setMarks] = useState('');
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
  const canContinue = whereDone && kind.trim() !== '' && color.trim() !== '';

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      // One plain sentence for the AI to parse, plus the same answers as separate fields.
      const whenText = { today: 'Lost it today.', yesterday: 'Lost it yesterday.', week: 'Lost it this week.', unsure: '' }[when];
      const text = [`${color} ${brand} ${kind}`.replace(/\s+/g, ' ').trim(), marks.trim() && `with ${marks.trim()}`]
        .filter(Boolean).join(' ') + `. ${whenText}`.trimEnd();
      form.append('text', text);
      form.append('category', kind.trim());
      form.append('color', color.trim());
      form.append('brand', brand.trim());
      form.append('marks', marks.trim());
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
                  <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(kind === k ? '' : k)} className={chip(kind === k)}>{k}</button>
                ))}
              </div>
              <input id="kind" value={kind} onChange={(e) => setKind(e.target.value)} placeholder="Or type it, e.g. umbrella" autoComplete="off" enterKeyHint="next" className={inputClass} />
            </div>

            <div>
              <p className="mb-2 text-[15px] font-semibold">2. Color and brand</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="color" className="mb-1 block text-sm text-neutral-700">Main color</label>
                  <input id="color" value={color} onChange={(e) => setColor(e.target.value)} placeholder="e.g. grey" autoComplete="off" enterKeyHint="next" className={inputClass} />
                </div>
                <div>
                  <label htmlFor="brand" className="mb-1 block text-sm text-neutral-700">Brand <span className="text-neutral-500">(optional)</span></label>
                  <input id="brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Hydro Flask" autoComplete="off" enterKeyHint="next" className={inputClass} />
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="marks" hint="e.g. a sticker, a case, a keychain, a scratch. Optional.">3. Anything that makes it stand out?</Label>
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
