// Person 1: finder flow. Photo → where → check details → what will you do with it → done.
'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { Building, HiddenDetail, PhotoAnalysis, PublicFoundItem, ReturnMethod } from '@/types';
import { api } from '@/lib/mock';
import { useBuildings } from '@/components/useBuildings';
import { PhotoInput } from '@/components/PhotoInput';
import { LocationField } from '@/components/LocationField';
import { LandmarkChips } from '@/components/LandmarkChips';
import { ChoiceCard, FlowBottomSpace, PrimaryAction, StepHeader, StickyAction } from '@/components/Flow';
import { Badge, Card, ErrorText, Label, LinkButton, Spinner, inputClass } from '@/components/ui';

const TOTAL = 4;

export default function FoundNew() {
  const { buildings } = useBuildings();
  const [step, setStep] = useState(1);
  const [photos, setPhotos] = useState<File[]>([]);
  const [building, setBuilding] = useState<Building | null>(null);
  const [landmark, setLandmark] = useState('');
  const [analysis, setAnalysis] = useState<PhotoAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [method, setMethod] = useState<ReturnMethod | null>(null);
  const [availability, setAvailability] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PublicFoundItem | null>(null);

  async function analyze() {
    setStep(3);
    setAnalysis(null);
    setError(null);
    setAnalyzing(true);
    try {
      const form = new FormData();
      photos.forEach((p) => form.append('photos', p));
      form.append('buildingId', building!.id);
      form.append('landmark', landmark);
      const a = await api.analyzeFound(form);
      setAnalysis(a);
      if (a.is_valuable) setMethod('desk');
    } catch {
      // AI failed: let the finder fill the basics in by hand.
      setAnalysis({ is_valid_item: true, reject_reason: null, category: '', color: '', brand: null, public_title: '', hidden_details: [], verifiability: 'low', is_valuable: false });
      setError('We couldn’t read the photo automatically. Please fill in the details below.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function submit() {
    if (!analysis || !building || !method) return;
    setSubmitting(true);
    setError(null);
    try {
      const final: PhotoAnalysis = {
        ...analysis,
        public_title: `${capital(analysis.color)} ${analysis.category} · ${building.name}`.trim(),
      };
      const form = new FormData();
      photos.forEach((p) => form.append('photos', p));
      form.append('buildingId', building.id);
      form.append('landmark', landmark);
      form.append('foundAt', new Date().toISOString());
      form.append('analysis', JSON.stringify(final));
      form.append('returnMethod', method);
      form.append('availability', method === 'finder' ? availability : '');
      const { item } = await api.submitFound(form);
      setDone(item);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) return <Done item={done} />;

  return (
    <div>
      {step === 1 && (
        <>
          <StepHeader step={1} total={TOTAL} title="Take a photo of what you found" help="One clear photo is enough. Add more if there are stickers, marks or a name tag." />
          <PhotoInput files={photos} onChange={setPhotos} />
          <p className="mt-4 text-sm text-neutral-600">Other students only ever see a blurred version.</p>
          <StickyAction>
            <PrimaryAction disabled={!photos.length} onClick={() => setStep(2)}>Next</PrimaryAction>
          </StickyAction>
        </>
      )}

      {step === 2 && (
        <>
          <StepHeader step={2} total={TOTAL} title="Where did you find it?" help="We filled in your building from your location. Change it if it's wrong." onBack={() => setStep(1)} />
          <div className="space-y-5">
            <LocationField buildings={buildings} value={building} onChange={setBuilding} />
            <div>
              <Label hint="Optional, but it helps the owner a lot.">Where exactly?</Label>
              <LandmarkChips value={landmark} onChange={setLandmark} />
            </div>
          </div>
          <StickyAction>
            <PrimaryAction disabled={!building} onClick={analyze}>Next</PrimaryAction>
          </StickyAction>
        </>
      )}

      {step === 3 && (
        <>
          <StepHeader step={3} total={TOTAL} title="Check the details" help="We read your photo. Fix anything that's wrong." onBack={() => setStep(2)} />
          {analyzing && (
            <Card className="flex items-center gap-3 text-sm text-neutral-700"><span role="status" className="flex items-center gap-3"><Spinner /> Looking at your photo…</span></Card>
          )}
          {analysis && !analysis.is_valid_item && (
            <Card className="space-y-3">
              <p className="font-semibold">We can&apos;t post this one</p>
              <p className="text-sm text-neutral-600">{analysis.reject_reason}</p>
            </Card>
          )}
          {analysis && analysis.is_valid_item && (
            <DetailsEditor analysis={analysis} onChange={setAnalysis} buildingName={building?.name ?? ''} />
          )}
          <div className="mt-3"><ErrorText error={error} /></div>
          <FlowBottomSpace />
          <StickyAction>
            {analysis && !analysis.is_valid_item ? (
              <PrimaryAction onClick={() => { setPhotos([]); setStep(1); }}>Retake photo</PrimaryAction>
            ) : (
              <PrimaryAction disabled={analyzing || !analysis?.category || !analysis?.color} onClick={() => setStep(4)}>Looks right</PrimaryAction>
            )}
          </StickyAction>
        </>
      )}

      {step === 4 && (
        <>
          <StepHeader step={4} total={TOTAL} title="What will you do with it?" help="Either way, the owner has to prove it's theirs first." onBack={() => setStep(3)} />
          <div className="space-y-3">
            <ChoiceCard
              selected={method === 'desk'} onSelect={() => setMethod('desk')}
              title="Drop it at DPS Lost & Found"
              body="Easiest for you. DPS hands it over once the owner is verified."
              badge={analysis?.is_valuable ? <Badge tone="gold">Recommended for valuables</Badge> : undefined}
            />
            <ChoiceCard
              selected={method === 'finder'} onSelect={() => setMethod('finder')}
              title="Keep it until the owner is found"
              body="You'll meet the verified owner in a public spot and check their pickup code."
            />
            {method === 'finder' && (
              <div>
                <Label htmlFor="availability" hint="So the owner knows when to meet you.">When are you usually free?</Label>
                <input id="availability" enterKeyHint="done" autoComplete="off" value={availability} onChange={(e) => setAvailability(e.target.value)} placeholder="e.g. Weekdays 10 AM – 4 PM" className={inputClass} />
              </div>
            )}
            <ErrorText error={error} />
          </div>
          <FlowBottomSpace />
          <StickyAction>
            <PrimaryAction disabled={!method || (method === 'finder' && !availability.trim())} loading={submitting} onClick={submit}>
              Post found item
            </PrimaryAction>
          </StickyAction>
        </>
      )}
    </div>
  );
}

function DetailsEditor({ analysis, onChange, buildingName }:
  { analysis: PhotoAnalysis; onChange: (a: PhotoAnalysis) => void; buildingName: string }) {
  const [newDetail, setNewDetail] = useState('');
  const set = (patch: Partial<PhotoAnalysis>) => onChange({ ...analysis, ...patch });
  const setDetails = (hidden_details: HiddenDetail[]) => onChange({ ...analysis, hidden_details });

  return (
    <div className="space-y-5">
      <Card>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-600">Everyone sees</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="category">What is it?</Label>
            <input id="category" autoComplete="off" enterKeyHint="next" value={analysis.category} onChange={(e) => set({ category: e.target.value })} placeholder="e.g. water bottle" className={inputClass} />
          </div>
          <div>
            <Label htmlFor="color">Main color</Label>
            <input id="color" autoComplete="off" enterKeyHint="next" value={analysis.color} onChange={(e) => set({ color: e.target.value })} placeholder="e.g. black" className={inputClass} />
          </div>
        </div>
        <p className="mt-3 text-sm text-neutral-600">Shown as: <span className="font-medium text-neutral-900">{capital(analysis.color)} {analysis.category || '…'} · {buildingName}</span></p>
      </Card>

      <Card className="border-transparent bg-cream">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#5A4E3E]">Kept private</p>
        <p className="mb-3 mt-1 text-sm text-neutral-600">Only used to check the real owner. Never shown to anyone browsing.</p>
        <div className="mb-3">
          <Label htmlFor="brand">Brand</Label>
          <input id="brand" autoComplete="off" value={analysis.brand ?? ''} onChange={(e) => set({ brand: e.target.value || null })} placeholder="If you can tell" className={inputClass} />
        </div>
        <Label htmlFor="new-detail">Distinguishing marks</Label>
        <ul className="space-y-2">
          {analysis.hidden_details.map((d, i) => (
            <li key={i} className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-sm">
              <span>{d.detail}</span>
              <button type="button" onClick={() => setDetails(analysis.hidden_details.filter((_, j) => j !== i))} aria-label={`Remove: ${d.detail}`} className="min-h-11 shrink-0 rounded-xl px-2 text-sm font-semibold text-neutral-700 hover:text-red-700">Remove</button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <input id="new-detail" autoComplete="off" enterKeyHint="done" value={newDetail} onChange={(e) => setNewDetail(e.target.value)} placeholder="Add one: sticker, scratch, name…" className={inputClass} />
          <button
            type="button" disabled={!newDetail.trim()}
            onClick={() => { setDetails([...analysis.hidden_details, { detail: newDetail.trim(), weight: 3 }]); setNewDetail(''); }}
            className="min-h-12 shrink-0 rounded-[14px] border border-neutral-300 bg-white px-4 text-sm font-semibold disabled:text-neutral-500"
          >
            Add
          </button>
        </div>
      </Card>
    </div>
  );
}

function Done({ item }: { item: PublicFoundItem }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => { QRCode.toDataURL(item.item_code, { margin: 1, width: 320 }).then(setQr).catch(() => {}); }, [item.item_code]);
  const desk = item.return_method === 'desk';
  return (
    <div className="pt-4 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl text-green-700">✓</div>
      <h1 className="text-2xl font-bold">Thanks, it&apos;s posted</h1>
      <p className="mx-auto mt-2 max-w-xs text-sm text-neutral-600">
        {desk ? 'Drop it at DPS Lost & Found and show this code at the desk.' : 'We’ll alert you when the owner is verified. Hold on to it until then.'}
      </p>
      <Card className="mx-auto mt-6 max-w-xs">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Item code</p>
        <p className="mt-1 text-3xl font-bold tracking-widest">{item.item_code}</p>
        {desk && qr && <img src={qr} alt={`QR code for ${item.item_code}`} className="mx-auto mt-3 h-40 w-40" />}
      </Card>
      <div className="mx-auto mt-8 flex max-w-xs flex-col gap-2">
        <LinkButton href="/my">See my items</LinkButton>
        <LinkButton href="/" variant="secondary">Back to home</LinkButton>
      </div>
    </div>
  );
}

function capital(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
