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
import { ErrorText, Spinner, inputClass } from '@/components/ui';

const TOTAL = 3;
const PROMPTS = ['What color is it?', 'Brand?', 'Any stickers or marks?', 'When did you last have it?'];

export default function LostNew() {
  const router = useRouter();
  const { buildings } = useBuildings();
  const { state: loc, locate } = useCurrentBuilding(buildings);
  const [step, setStep] = useState(1);
  const [text, setText] = useState('');
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
      form.append('text', text.trim());
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
          <StepHeader step={1} total={TOTAL} title="What did you lose?" help="Describe it like you'd tell a friend. The more detail, the better the match." />
          <textarea
            value={text} onChange={(e) => setText(e.target.value)} rows={5} autoFocus
            placeholder="e.g. Grey Hydro Flask with a pink sticker, lost near Viterbi yesterday afternoon"
            className={`${inputClass} resize-none`}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {PROMPTS.map((p) => <span key={p} className="rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-600">{p}</span>)}
          </div>
          <p className="mt-4 text-xs text-neutral-500">Keep a detail or two to yourself (like a sticker). You may be asked about it to prove it&apos;s yours.</p>
          <FlowBottomSpace />
          <StickyAction>
            <PrimaryAction disabled={text.trim().length < 8} onClick={() => setStep(2)}>Next</PrimaryAction>
          </StickyAction>
        </>
      )}

      {step === 2 && (
        <>
          <StepHeader step={2} total={TOTAL} title="Where might you have lost it?" help="Add every place you went. We'll look nearby too." onBack={() => setStep(1)} />
          {!notSure && (
            <div className="space-y-2">
              {loc.kind === 'locating' && !places.length && (
                <p className="flex items-center gap-2 text-sm text-neutral-600"><Spinner small /> Adding where you are now…</p>
              )}
              {places.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-xl border border-neutral-300 bg-white px-3 py-3">
                  <span className="font-medium">{p.name}</span>
                  <button type="button" onClick={() => setPlaces(places.filter((x) => x.id !== p.id))} className="text-sm font-semibold text-neutral-500 hover:text-red-700">Remove</button>
                </div>
              ))}
              <button type="button" onClick={() => setPicking(true)}
                className="w-full rounded-xl border-2 border-dashed border-neutral-300 px-3 py-3 text-sm font-semibold text-neutral-700 hover:border-cardinal hover:text-cardinal">
                + Add a place
              </button>
            </div>
          )}
          <label className="mt-5 flex items-center gap-3 rounded-xl bg-white px-3 py-3 text-sm">
            <input type="checkbox" checked={notSure} onChange={(e) => setNotSure(e.target.checked)} className="h-5 w-5 accent-[#990000]" />
            I&apos;m not sure where. Search all of campus.
          </label>
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
