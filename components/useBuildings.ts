// Person 1: loads the campus building list once and shares it across screens.
'use client';

import { useEffect, useState } from 'react';
import type { Building } from '@/types';
import { api } from '@/lib/mock';

let cache: Building[] | null = null;
let pending: Promise<Building[]> | null = null;

export function useBuildings() {
  const [buildings, setBuildings] = useState<Building[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    pending ??= api.buildings().then((b) => (cache = b));
    pending.then(setBuildings).catch(() => setBuildings([]));
  }, []);
  const nameOf = (id: string | null | undefined) => buildings.find((b) => b.id === id)?.name ?? 'Campus';
  return { buildings, nameOf, loaded: buildings.length > 0 };
}
