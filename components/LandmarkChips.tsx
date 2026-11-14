// Person 1: optional landmark inside a building (one-tap chips + free text).
'use client';

import { inputClass } from './ui';

export const LANDMARKS = ['2nd floor', 'Near printers', 'Outside entrance', 'Classroom', 'Bench', 'Dining area', 'Shuttle stop'];

export function LandmarkChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        {LANDMARKS.map((l) => {
          const on = value.toLowerCase() === l.toLowerCase();
          return (
            <button
              type="button" key={l} onClick={() => onChange(on ? '' : l)}
              className={`rounded-full border px-3 py-1.5 text-sm ${on ? 'border-cardinal bg-red-50 text-cardinal' : 'border-neutral-300 bg-white text-neutral-700'}`}
            >
              {l}
            </button>
          );
        })}
      </div>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Or type it: e.g. 3rd floor study room" className={inputClass} maxLength={80} />
    </div>
  );
}
