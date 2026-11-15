// Person 1: possible matches for a lost report.
'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { MatchWithItem, ParsedLostReport } from '@/types';
import { api } from '@/lib/mock';
import { ItemCard } from '@/components/ItemCard';
import { useBuildings } from '@/components/useBuildings';
import { Button, Card, EmptyState, ErrorText, Loading, PageTitle } from '@/components/ui';

export default function LostMatchesRoute() {
  return <Suspense fallback={<Loading />}><LostMatches key={useRouter().bfcacheId} /></Suspense>;
}

function LostMatches() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { nameOf } = useBuildings();
  const [parsed, setParsed] = useState<ParsedLostReport | null>(null);
  const [matches, setMatches] = useState<MatchWithItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem(`lost:${id}`);
    if (saved) {
      // Fresh from the report form: show the parsed fields + matches without a second request.
      const res = JSON.parse(saved) as { parsed: ParsedLostReport; matches: MatchWithItem[] };
      setParsed(res.parsed); // eslint-disable-line react-hooks/set-state-in-effect
      setMatches(res.matches);
      sessionStorage.removeItem(`lost:${id}`);
      return;
    }
    api.matches(id).then(setMatches).catch((e) => setError(e.message));
  }, [id]);

  async function foundIt() {
    setClosing(true);
    try {
      await api.closeLost(id);
      router.push('/my');
    } catch (e) {
      setError((e as Error).message);
      setClosing(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageTitle
        title={matches?.length ? 'These might be yours' : 'We’re on the lookout'}
        subtitle={matches?.length ? 'Tap one to check. You’ll answer a couple of quick questions to prove it’s yours.' : undefined}
      />

      {parsed && (
        <Card className="bg-neutral-50">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">We&apos;re looking for</p>
          <p className="mt-1 font-medium capitalize">{[parsed.color, parsed.brand, parsed.category].filter(Boolean).join(' ')}</p>
          {parsed.marks.length > 0 && <p className="text-sm text-neutral-600">with {parsed.marks.join(', ')}</p>}
        </Card>
      )}

      <ErrorText error={error} />
      {!matches && !error && <Loading label="Checking found items…" />}

      {matches && matches.length === 0 && (
        <EmptyState title="No matches yet" body="We'll alert you as soon as someone reports something that looks like yours. You don't need to keep checking." />
      )}

      <div className="space-y-3">
        {matches?.map((m) => (
          <ItemCard key={m.item.id} item={m.item} buildingName={nameOf(m.item.found_building_id)} href={`/items/${m.item.id}?lost=${id}`} reason={m.public_reason} score={m.score} />
        ))}
      </div>

      <div className="pt-4 text-center">
        <Button variant="ghost" loading={closing} onClick={foundIt}>I found it myself. Close this report.</Button>
      </div>
    </div>
  );
}
