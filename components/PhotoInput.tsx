// Person 1: take or upload 1-3 photos; opens the rear camera on phones.
/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useMemo, useRef } from 'react';
import { compressImage } from './compress';

export function PhotoInput({ files, onChange, max = 3, required = true }:
  { files: File[]; onChange: (f: File[]) => void; max?: number; required?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  async function add(list: FileList | null) {
    if (!list) return;
    const picked = await Promise.all(Array.from(list).slice(0, max - files.length).map((f) => compressImage(f)));
    onChange([...files, ...picked].slice(0, max));
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {urls.map((u, i) => (
          <div key={u} className="relative aspect-square overflow-hidden rounded-xl bg-neutral-100">
            <img src={u} alt={`Your photo ${i + 1}`} className="h-full w-full object-cover" />
            <button
              type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => onChange(files.filter((_, j) => j !== i))}
              className="absolute inset-x-1.5 bottom-1.5 min-h-10 rounded-xl bg-black/70 text-sm font-semibold text-white"
            >
              Remove
            </button>
          </div>
        ))}
        {files.length < max && (
          <button
            type="button" onClick={() => inputRef.current?.click()}
            className="flex aspect-square flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-400 text-sm font-medium text-neutral-700 hover:border-cardinal hover:text-cardinal"
          >
            <span className="text-2xl leading-none">+</span>
            <span className="mt-1">{files.length ? 'Add photo' : required ? 'Take photo' : 'Add photo'}</span>
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple aria-label="Add photos" className="hidden" onChange={(e) => add(e.target.files)} />
    </div>
  );
}
