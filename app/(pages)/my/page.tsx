// Person 1: everything I've reported or claimed, with the next step on each card.
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { MyItems, PublicFoundItem, ClaimDetail } from '@/types';
import { api } from '@/lib/mock';
import { deskName } from '@/components/desks';
import { useBuildings } from '@/components/useBuildings';
import { claimStatusLabel, itemStatusLabel, shortDate } from '@/components/format';
import { Badge, Button, Card, EmptyState, ErrorText, LinkButton, Loading, PageTitle, inputClass } from '@/components/ui';

export default function MyPage() {
  const [me, setMe] = useState<MyItems | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.myItems().then(setMe).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  if (error && !me) return <ErrorText error={error} />;
  if (!me) return <Loading />;

  const empty = !me.found.length && !me.lost.length && !me.claims.length;

  return (
    <div className="space-y-8">
      <PageTitle title="My stuff" />
      {empty && (
        <EmptyState title="Nothing here yet" body="Things you report or claim will show up here." action={<LinkButton href="/">Go to home</LinkButton>} />
      )}

      {me.claims.length > 0 && (
        <Section title="Items I'm claiming">
          {me.claims.map((c) => <ClaimRow key={c.id} claim={c} />)}
        </Section>
      )}

      {me.lost.length > 0 && (
        <Section title="Things I lost">
          {me.lost.map((l) => (
            <Link key={l.id} href={`/lost/${l.id}`} className="block rounded-[20px] border border-neutral-200 bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{l.summary}</p>
                <Badge tone={l.status === 'open' ? 'gold' : 'neutral'}>{l.status === 'open' ? 'Searching' : l.status === 'resolved' ? 'Found' : 'Closed'}</Badge>
              </div>
              <p className="mt-1 text-sm text-neutral-600">
                {l.match_count ? `${l.match_count} possible match${l.match_count > 1 ? 'es' : ''}. Tap to check →` : 'No matches yet. We’ll alert you.'}
              </p>
            </Link>
          ))}
        </Section>
      )}

      {me.found.length > 0 && (
        <Section title="Things I found">
          {me.found.map((f) => <FoundRow key={f.id} item={f} pending={f.pending_claims} onChange={load} />)}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ClaimRow({ claim }: { claim: ClaimDetail }) {
  const action =
    claim.status === 'awaiting_answers' ? 'Answer questions →'
    : claim.status === 'likely_owner' || claim.status === 'approved' ? 'See pickup code →'
    : 'View →';
  const tone = claim.status === 'rejected' ? 'red' : claim.status === 'needs_review' ? 'blue' : claim.status === 'returned' ? 'neutral' : 'green';
  return (
    <Link href={`/claims/${claim.id}`} className="flex items-center justify-between gap-3 rounded-[20px] border border-neutral-200 bg-white p-4">
      <div>
        <p className="font-medium capitalize">{claim.item.color} {claim.item.category}</p>
        <div className="mt-1"><Badge tone={tone}>{claimStatusLabel[claim.status]}</Badge></div>
      </div>
      <span className="text-sm font-semibold text-cardinal">{action}</span>
    </Link>
  );
}

function FoundRow({ item, pending, onChange }: { item: PublicFoundItem; pending: ClaimDetail[]; onChange: () => void }) {
  const { nameOf } = useBuildings();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toReview = pending.filter((c) => c.status === 'needs_review');

  async function run(kind: string, fn: () => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    try { await fn(); onChange(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium capitalize">{item.color} {item.category}</p>
          <p className="text-sm text-neutral-600">{nameOf(item.found_building_id)} · {shortDate(item.found_date)} · {item.item_code}</p>
        </div>
        <Badge tone={item.status === 'returned' ? 'green' : 'neutral'}>{itemStatusLabel[item.status]}</Badge>
      </div>

      {item.status === 'en_route_to_desk' && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Next: drop it at {deskName(item.held_at_desk_id)} and give them code <b>{item.item_code}</b>.</p>
      )}

      {toReview.map((c) => (
        <Link key={c.id} href={`/claims/${c.id}`} className="block rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-cardinal">
          Someone claimed this. Review their answers →
        </Link>
      ))}

      {item.status === 'with_finder' && (
        <>
          <div>
            <p className="mb-1 text-sm font-semibold">Meeting the owner?</p>
            <p className="mb-2 text-sm text-neutral-600">Ask for their 6-digit pickup code and enter it before you hand it over.</p>
            <div className="flex gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="off" enterKeyHint="done" aria-label="Owner's pickup code" placeholder="Pickup code" className={inputClass} />
              <Button disabled={code.length !== 6} loading={busy === 'return'} onClick={() => run('return', () => api.returnItem(item.id, code))}>Confirm</Button>
            </div>
          </div>
          <Button variant="secondary" className="w-full" loading={busy === 'desk'} onClick={() => run('desk', () => api.switchToDesk(item.id))}>
            Drop it at DPS instead
          </Button>
        </>
      )}
      <ErrorText error={error} />
    </Card>
  );
}
