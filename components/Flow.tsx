// Person 1: building blocks for step-by-step screens. One question per step, one button at the bottom.
'use client';

import type { ReactNode } from 'react';
import { Button } from './ui';

export function StepHeader({ step, total, title, help, onBack }:
  { step: number; total: number; title: string; help?: string; onBack?: () => void }) {
  return (
    <div className="mb-5">
      <div className="mb-3 flex items-center gap-3">
        {onBack ? (
          <button type="button" onClick={onBack} className="-ml-2 flex min-h-11 items-center gap-1 rounded-xl px-2 text-[15px] font-semibold text-neutral-800 hover:bg-neutral-100">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
            Back
          </button>
        ) : <span />}
        <span className="ml-auto text-sm font-medium text-neutral-600">Step {step} of {total}</span>
      </div>
      <div role="progressbar" aria-label="Progress" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step} className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-cardinal transition-all" style={{ width: `${(step / total) * 100}%` }} />
      </div>
      <h1 className="text-2xl font-bold leading-tight tracking-tight">{title}</h1>
      {help && <p className="mt-1.5 text-sm text-neutral-600">{help}</p>}
    </div>
  );
}

/** The single main action, pinned above the bottom nav so it's always in reach. */
export function StickyAction({ children, secondary }: { children: ReactNode; secondary?: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(3.25rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-md border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
      <div className="flex flex-col gap-2">{children}{secondary}</div>
    </div>
  );
}

export function PrimaryAction(props: Parameters<typeof Button>[0]) {
  return <Button {...props} className={`w-full text-base ${props.className ?? ''}`} />;
}

/** Big tappable option card (e.g. "Drop at DPS" vs "Keep it with me"). */
export function ChoiceCard({ selected, onSelect, title, body, badge }:
  { selected: boolean; onSelect: () => void; title: string; body: string; badge?: ReactNode }) {
  return (
    <button
      type="button" onClick={onSelect} aria-pressed={selected}
      className={`w-full rounded-[20px] border-2 p-4 text-left transition ${selected ? 'border-cardinal bg-red-50' : 'border-neutral-200 bg-white hover:border-neutral-400'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-semibold">{title}</span>
        <span aria-hidden="true" className={`h-5 w-5 shrink-0 rounded-full border-2 ${selected ? 'border-cardinal bg-cardinal shadow-[inset_0_0_0_3px_white]' : 'border-neutral-400'}`} />
      </div>
      <p className="mt-1 text-sm text-neutral-600">{body}</p>
      {badge && <div className="mt-2">{badge}</div>}
    </button>
  );
}

/** Spacer so content isn't hidden behind StickyAction + nav. */
export function FlowBottomSpace() {
  return <div className="h-28" />;
}
