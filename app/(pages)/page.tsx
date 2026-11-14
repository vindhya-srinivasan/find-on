// Person 1: home. Two big actions + recent public listings.
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PublicFoundItem } from '@/types';
import { api } from '@/lib/mock';
import { Attention } from '@/components/Attention';
import { ItemCard } from '@/components/ItemCard';
import { useBuildings } from '@/components/useBuildings';
import { EmptyState, ErrorText, Loading } from '@/components/ui';

export default function Home() {
  const { nameOf } = useBuildings();
  const [items, setItems] = useState<PublicFoundItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.recentItems().then(setItems).catch((e) => setError(e.message)); }, []);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold leading-tight tracking-tight">Lost something on campus?<br />Found something?</h1>
        <p className="mt-2 text-sm text-neutral-600">FindOn matches what people find with what people lose, across all of USC.</p>
      </section>

      <Attention />

      <section className="space-y-3">
        <Link href="/found/new" className="flex items-center justify-between rounded-2xl bg-cardinal p-5 text-white shadow-sm transition active:scale-[0.98]">
          <span>
            <span className="block text-xl font-bold">I found something</span>
            <span className="mt-1 block text-sm text-red-100">Snap a photo. Takes about 10 seconds.</span>
          </span>
          <span aria-hidden className="text-2xl">→</span>
        </Link>
        <Link href="/lost/new" className="flex items-center justify-between rounded-2xl bg-gold p-5 text-neutral-900 shadow-sm transition active:scale-[0.98]">
          <span>
            <span className="block text-xl font-bold">I lost something</span>
            <span className="mt-1 block text-sm text-neutral-800">Describe it. We&apos;ll alert you when it turns up.</span>
          </span>
          <span aria-hidden className="text-2xl">→</span>
        </Link>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Recently found</h2>
        <ErrorText error={error} />
        {!items && !error && <Loading />}
        {items && items.length === 0 && <EmptyState title="Nothing reported yet" body="Found items across campus will show up here." />}
        <div className="space-y-3">
          {items?.map((it) => <ItemCard key={it.id} item={it} buildingName={nameOf(it.found_building_id)} href={`/items/${it.id}`} />)}
        </div>
        <p className="mt-4 text-center text-xs text-neutral-500">Photos stay blurred. Only the real owner sees the details.</p>
      </section>
    </div>
  );
}
