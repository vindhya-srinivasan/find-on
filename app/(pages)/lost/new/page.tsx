// Person 1: owner flow. Describe it → where might it be → optional photo → see matches.
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

const TOTAL = 3;
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

export default function LostNew() {
  const router = useRouter();
  const { buildings } = useBuildings();
  const { state: loc, locate } = useCurrentBuilding(buildings);
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState('');
  const [color, setColor] = useState('');
  const [brand, setBrand] = useState('');
  const [marks, setMarks] = useState('');
  const [when, setWhen] = useState<When>('unsure');
  const [chosen, setChosen] = useState<Building[] | null>(null); // null = user hasn't edited yet
  // Until the user edits the list, start with where they are now.
  const places = chosen ?? (loc.kind === 'found' ? [loc.building] : []);
  const setPlaces = (next: Building[] | ((p: Building[]) => Building[])) =>
    setChosen(typeof next === 'function' ? next(places) : next);
  const [notSure, setNotSure] = useState(false);
  const [picking, setPicking] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (buildings.length) locate(); }, [buildings.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <StepHeader step={1} total={TOTAL} title="What did you lose?" help="Three quick questions. Short answers are fine." />
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
              <p className="mt-2 rounded-xl bg-cream px-3 py-2 text-sm text-[#5A4E3E]">Tip: keep one detail to yourself. You may be asked about it to prove it&apos;s yours.</p>
            </div>
          </div>
          <FlowBottomSpace />
          <StickyAction>
            <PrimaryAction disabled={!kind.trim() || !color.trim()} onClick={() => setStep(2)}>Next</PrimaryAction>
          </StickyAction>
        </>
      )}

      {step === 2 && (
        <>
          <StepHeader step={2} total={TOTAL} title="Where and when?" help="Add every place you went. We'll look nearby too." onBack={() => setStep(1)} />
          {!notSure && (
            <div className="space-y-2">
              {loc.kind === 'locating' && !places.length && (
                <p role="status" className="flex items-center gap-2 text-sm text-neutral-700"><Spinner small /> Adding where you are now…</p>
              )}
              {places.map((p) => (
                <div key={p.id} className="flex min-h-12 items-center justify-between rounded-[14px] border border-neutral-300 bg-white pl-3.5 pr-1">
                  <span className="font-medium">{p.name}</span>
                  <button type="button" onClick={() => setPlaces(places.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.name}`} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-neutral-700 hover:text-red-700">Remove</button>
                </div>
              ))}
              <button type="button" onClick={() => setPicking(true)}
                className="min-h-12 w-full rounded-[14px] border-2 border-dashed border-neutral-400 px-3 text-sm font-semibold text-neutral-800 hover:border-cardinal hover:text-cardinal">
                + Add a place
              </button>
            </div>
          )}
          <label className="mt-5 flex min-h-12 items-center gap-3 rounded-[14px] bg-cream px-3.5 py-3 text-[15px]">
            <input type="checkbox" checked={notSure} onChange={(e) => setNotSure(e.target.checked)} className="h-5 w-5" />
            I&apos;m not sure where. Search all of campus.
          </label>
          <fieldset className="mt-6">
            <legend className="mb-2 text-[15px] font-semibold">When did you last have it?</legend>
            <div className="flex flex-wrap gap-2">
              {WHEN.map((w) => (
                <button key={w.id} type="button" aria-pressed={when === w.id} onClick={() => setWhen(w.id)} className={chip(when === w.id)}>{w.label}</button>
              ))}
            </div>
          </fieldset>
          {picking && (
            <BuildingPicker buildings={buildings} title="Add a place" onClose={() => setPicking(false)}
              onPick={(b) => { setPlaces((p) => (p.some((x) => x.id === b.id) ? p : [...p, b])); setPicking(false); }} />
          )}
          <FlowBottomSpace />
          <StickyAction>
            <PrimaryAction disabled={!notSure && !places.length} onClick={() => setStep(3)}>Next</PrimaryAction>
          </StickyAction>
        </>
      )}

      {step === 3 && (
        <>
          <StepHeader step={3} total={TOTAL} title="Have a photo of it?" help="Optional. An old photo from your camera roll helps prove it's yours." onBack={() => setStep(2)} />
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
