// Person 1: desk staff dashboard (DPS, library desks). Receive items, review claims, release items.
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ClaimDetail, DeskQueue, PublicFoundItem } from '@/types';
import { api } from '@/lib/mock';
import { useBuildings } from '@/components/useBuildings';
import { shortDate } from '@/components/format';
import { Button, Card, EmptyState, ErrorText, Loading, PageTitle, inputClass } from '@/components/ui';

export default function DeskPage() {
  const [q, setQ] = useState<DeskQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.deskQueue().then(setQ).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  if (error && !q) return <ErrorText error={error} />;
  if (!q) return <Loading />;

  return (
    <div className="space-y-8">
      <PageTitle title="Desk" subtitle="DPS Lost & Found" />
      <Receive onDone={load} expected={q.en_route} />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Claims to review ({q.reviews.length})</h2>
        {q.reviews.length === 0 ? <EmptyState title="Nothing to review" /> : (
          <div className="space-y-3">{q.reviews.map((c) => <ReviewCard key={c.id} claim={c} onDone={load} />)}</div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">At this desk ({q.at_desk.length})</h2>
        {q.at_desk.length === 0 ? <EmptyState title="No items at the desk" /> : (
          <div className="space-y-3">{q.at_desk.map((it) => <ReleaseCard key={it.id} item={it} onDone={load} />)}</div>
        )}
      </section>
    </div>
  );
}

function Receive({ onDone, expected }: { onDone: () => void; expected: PublicFoundItem[] }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function receive() {
    setBusy(true); setError(null); setMsg(null);
    try {
      const { item } = await api.receiveItem(code);
      setMsg(`Received: ${item.color} ${item.category} (${item.item_code})`);
      setCode('');
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Card className="space-y-3">
      <p className="font-semibold">Someone dropping off an item?</p>
      <p className="text-sm text-neutral-600">Type the item code from their phone.</p>
      <div className="flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="FO-1234" className={inputClass} />
        <Button disabled={code.trim().length < 4} loading={busy} onClick={receive}>Receive</Button>
      </div>
      {msg && <p className="rounded-xl bg-green-50 px-3 py-2 text-sm text-green-800">{msg}</p>}
      <ErrorText error={error} />
      {expected.length > 0 && <p className="text-xs text-neutral-500">Expected: {expected.map((e) => e.item_code).join(', ')}</p>}
    </Card>
  );
}

function ReviewCard({ claim, onDone }: { claim: ClaimDetail; onDone: () => void }) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  async function decide(d: 'approve' | 'reject') { setBusy(d); await api.reviewClaim(claim.id, d).catch(() => {}); onDone(); }
  return (
    <Card className="space-y-3">
      <p className="font-medium capitalize">{claim.item.color} {claim.item.category} · {claim.item.item_code}</p>
      {typeof claim.score === 'number' && <p className="text-sm"><b>Score {claim.score}/100.</b> {claim.reason}</p>}
      {claim.answers?.map((a, i) => (
        <div key={i} className="rounded-xl bg-neutral-50 px-3 py-2 text-sm">
          <p className="text-xs text-neutral-500">{a.question}</p>
          <p>{a.answer}</p>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="danger" loading={busy === 'reject'} onClick={() => decide('reject')}>Not the owner</Button>
        <Button loading={busy === 'approve'} onClick={() => decide('approve')}>Approve</Button>
      </div>
    </Card>
  );
}

function ReleaseCard({ item, onDone }: { item: PublicFoundItem; onDone: () => void }) {
  const { nameOf } = useBuildings();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function release() {
    setBusy(true); setError(null);
    try { await api.returnItem(item.id, code); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Card className="space-y-3">
      <div>
        <p className="font-medium capitalize">{item.color} {item.category} · {item.item_code}</p>
        <p className="text-sm text-neutral-600">Found at {nameOf(item.found_building_id)} · {shortDate(item.found_date)}</p>
      </div>
      <div className="flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="Owner's pickup code" className={inputClass} />
        <Button disabled={code.length !== 6} loading={busy} onClick={release}>Release</Button>
      </div>
      <p className="text-xs text-neutral-500">Check their USC ID too.</p>
      <ErrorText error={error} />
    </Card>
  );
}
