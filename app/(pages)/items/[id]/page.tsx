// Person 1: one found item. Owners start a claim here.
'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type { ItemDetail, LostReportSummary } from '@/types';
import { api } from '@/lib/mock';
import { Thumb } from '@/components/Thumb';
import { useBuildings } from '@/components/useBuildings';
import { itemStatusLabel, shortDate } from '@/components/format';
import { FlowBottomSpace, PrimaryAction, StickyAction } from '@/components/Flow';
import { Badge, Card, ErrorText, LinkButton, Loading } from '@/components/ui';

export default function ItemPage() {
  return <Suspense fallback={<Loading />}><ItemView key={useRouter().bfcacheId} /></Suspense>;
}

function ItemView() {
  const { id } = useParams<{ id: string }>();
  const lostFromLink = useSearchParams().get('lost');
  const router = useRouter();
  const { nameOf } = useBuildings();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [myLost, setMyLost] = useState<LostReportSummary[] | null>(null);
  const [lostId, setLostId] = useState<string | null>(lostFromLink);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api.item(id).then(setItem).catch((e) => setError(e.message));
    if (!lostFromLink) {
      api.myItems().then((m) => {
        const open = m.lost.filter((l) => l.status === 'open');
        setMyLost(open);
        if (open.length === 1) setLostId(open[0].id);
      }).catch(() => setMyLost([]));
    }
  }, [id, lostFromLink]);

  async function claim() {
    if (!lostId) return;
    setStarting(true);
    setError(null);
    try {
      const { claimId } = await api.startClaim({ foundItemId: id, lostReportId: lostId });
      router.push(`/claims/${claimId}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  }

  if (error && !item) return <ErrorText error={error} />;
  if (!item) return <Loading />;

  const isPublic = item.viewer === 'public';
  const closed = item.status === 'returned' || item.status === 'unclaimed';
  const needsReport = isPublic && !lostFromLink && myLost !== null && myLost.length === 0;

  return (
    <div className="space-y-5">
      <Thumb src={item.photo_urls?.[0] ?? item.blurred_thumb_url} blurred={isPublic} size="lg" label={item.category} />

      <div>
        <h1 className="text-2xl font-bold capitalize">{item.color} {item.category}</h1>
        <p className="mt-1 text-neutral-600">Found at {nameOf(item.found_building_id)} · {shortDate(item.found_date)}</p>
        <div className="mt-2"><Badge>{itemStatusLabel[item.status]}</Badge></div>
      </div>

      {isPublic ? (
        <Card className="text-sm text-neutral-600">
          The photo is blurred and identifying details are hidden so only the real owner can claim it. If it&apos;s yours, you&apos;ll answer 2–3 quick questions about it.
        </Card>
      ) : (
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Private details</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {item.hidden_details?.map((d, i) => <li key={i}>{d.detail}</li>)}
          </ul>
          {item.landmark && <p className="mt-2 text-sm text-neutral-600">Spot: {item.landmark}</p>}
        </Card>
      )}

      {isPublic && !closed && myLost && myLost.length > 1 && !lostFromLink && (
        <div>
          <p className="mb-2 text-sm font-semibold">Which of your lost items is this?</p>
          <div className="space-y-2">
            {myLost.map((l) => (
              <button key={l.id} type="button" onClick={() => setLostId(l.id)}
                className={`w-full rounded-xl border-2 px-3 py-3 text-left text-sm ${lostId === l.id ? 'border-cardinal bg-red-50' : 'border-neutral-200 bg-white'}`}>
                {l.summary}
              </button>
            ))}
          </div>
        </div>
      )}

      <ErrorText error={error} />
      <FlowBottomSpace />

      {isPublic && !closed && (
        <StickyAction>
          {needsReport ? (
            <>
              <p className="text-center text-sm text-neutral-600">First, tell us what you lost. It takes a minute.</p>
              <LinkButton href="/lost/new" className="w-full text-base">Report what I lost</LinkButton>
            </>
          ) : (
            <PrimaryAction disabled={!lostId} loading={starting} onClick={claim}>This might be mine</PrimaryAction>
          )}
        </StickyAction>
      )}
    </div>
  );
}
