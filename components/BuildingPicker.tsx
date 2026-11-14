// Person 1: searchable campus building list in a native <dialog> bottom sheet.
// Esc, the back gesture and tapping outside all close it.
'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Building } from '@/types';
import { inputClass } from './ui';

export function BuildingPicker({ buildings, onPick, onClose, title = 'Pick a building' }:
  { buildings: Building[]; onPick: (b: Building) => void; onClose: () => void; title?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const searchId = useId();
  const [q, setQ] = useState('');

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return buildings
      .filter((b) => b.type !== 'desk')
      .filter((b) => !s || b.name.toLowerCase().includes(s) || b.id.toLowerCase().includes(s))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [buildings, q]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) ref.current?.close(); }}
    >
      <div className="flex max-h-[80dvh] flex-col p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={() => ref.current?.close()} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-100">Close</button>
        </div>
        <label htmlFor={searchId} className="sr-only">Search buildings</label>
        <input
          id={searchId} type="search" enterKeyHint="search" autoComplete="off"
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search buildings (e.g. Taper, THH)" className={inputClass}
        />
        <ul className="mt-3 flex-1 overflow-y-auto overscroll-contain" aria-label="Buildings">
          {list.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => { onPick(b); ref.current?.close(); }} className="flex min-h-12 w-full items-center justify-between rounded-xl px-3 text-left hover:bg-neutral-100">
                <span className="font-medium">{b.name}</span>
                <span className="text-xs capitalize text-neutral-600">{b.type}</span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-neutral-600" role="status">No building matches “{q}”.</li>}
        </ul>
      </div>
    </dialog>
  );
}
