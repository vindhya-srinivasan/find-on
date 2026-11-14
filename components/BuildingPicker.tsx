// Person 1: searchable campus building list in a bottom sheet.
'use client';

import { useMemo, useState } from 'react';
import type { Building } from '@/types';
import { inputClass } from './ui';

export function BuildingPicker({ buildings, onPick, onClose, title = 'Pick a building' }:
  { buildings: Building[]; onPick: (b: Building) => void; onClose: () => void; title?: string }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return buildings
      .filter((b) => b.type !== 'desk')
      .filter((b) => !s || b.name.toLowerCase().includes(s) || b.id.toLowerCase().includes(s))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [buildings, q]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-t-3xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-100">Close</button>
        </div>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search buildings (e.g. Taper, THH)" className={inputClass} />
        <ul className="mt-3 flex-1 overflow-y-auto">
          {list.map((b) => (
            <li key={b.id}>
              <button onClick={() => onPick(b)} className="w-full rounded-xl px-3 py-3 text-left hover:bg-neutral-100">
                <span className="font-medium">{b.name}</span>
                <span className="ml-2 text-xs capitalize text-neutral-500">{b.type}</span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-neutral-500">No building matches “{q}”.</li>}
        </ul>
      </div>
    </div>
  );
}
