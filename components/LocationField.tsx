// Person 1: "Found at Taper Hall ✓ · change". Auto-detects on mount; falls back to the picker.
'use client';

import { useEffect, useState } from 'react';
import type { Building } from '@/types';
import { BuildingPicker } from './BuildingPicker';
import { useCurrentBuilding } from './useCurrentBuilding';
import { Spinner } from './ui';

export function LocationField({ buildings, value, onChange, prefix = 'Found at' }:
  { buildings: Building[]; value: Building | null; onChange: (b: Building) => void; prefix?: string }) {
  const { state, locate } = useCurrentBuilding(buildings);
  const [picking, setPicking] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => { if (buildings.length && !value) locate(); }, [buildings.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (state.kind === 'found' && !value) onChange(state.building);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  // Location failed: open the picker straight away (until the user closes it).
  const autoPick = (state.kind === 'failed' || state.kind === 'off_campus') && !value && !dismissed;
  const showPicker = picking || autoPick;

  return (
    <div aria-live="polite" className="rounded-[14px] border border-neutral-300 bg-white px-3.5 py-3">
      {value ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm"><span className="text-neutral-500">{prefix} </span><span className="font-semibold">{value.name}</span> <span className="text-green-700" aria-hidden="true">✓</span></p>
          <button type="button" onClick={() => setPicking(true)} className="min-h-11 rounded-xl px-2 text-sm font-semibold text-cardinal">Change</button>
        </div>
      ) : state.kind === 'locating' || state.kind === 'idle' ? (
        <p className="flex items-center gap-2 text-sm text-neutral-600"><Spinner small /> Finding your building…</p>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-neutral-600">
            {state.kind === 'off_campus' ? 'Looks like you’re off campus.' : state.kind === 'failed' ? state.reason : ''} Pick a building.
          </p>
          <button type="button" onClick={() => setPicking(true)} className="min-h-11 rounded-xl px-2 text-sm font-semibold text-cardinal">Pick</button>
        </div>
      )}
      {showPicker && (
        <BuildingPicker
          buildings={buildings}
          onClose={() => { setPicking(false); setDismissed(true); }}
          onPick={(b) => { onChange(b); setPicking(false); setDismissed(true); }}
        />
      )}
    </div>
  );
}
