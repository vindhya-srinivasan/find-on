// Person 1: optional landmark inside a building (one-tap chips + free text).
'use client';

import { useId } from 'react';
import { inputClass } from './ui';

export const LANDMARKS = ['2nd floor', 'Near printers', 'Outside entrance', 'Classroom', 'Bench', 'Dining area', 'Shuttle stop'];

export function LandmarkChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputId = useId();
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        {LANDMARKS.map((l) => {
          const on = value.toLowerCase() === l.toLowerCase();
          return (
            <button
              type="button" key={l} aria-pressed={on} onClick={() => onChange(on ? '' : l)}
              className={`min-h-11 rounded-full border px-4 text-sm font-medium ${on ? 'border-cardinal bg-red-50 text-cardinal' : 'border-neutral-300 bg-white text-neutral-800'}`}
            >
              {l}
            </button>
          );
        })}
      </div>
      <label htmlFor={inputId} className="sr-only">Describe the spot</label>
      <input id={inputId} enterKeyHint="done" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Or type it: e.g. 3rd floor study room" className={inputClass} maxLength={80} />
    </div>
  );
}
