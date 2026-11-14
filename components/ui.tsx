// Person 1: small shared UI pieces.
'use client';

import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-cardinal text-white hover:bg-[#7a0000] disabled:bg-neutral-300',
  secondary: 'bg-white text-neutral-900 border border-neutral-300 hover:bg-neutral-50 disabled:text-neutral-400',
  ghost: 'text-cardinal hover:bg-red-50',
  danger: 'bg-white text-red-700 border border-red-300 hover:bg-red-50',
};

export function Button({ variant = 'primary', className = '', loading, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = 'primary', className = '', children }:
  { href: string; variant?: Variant; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={`inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-neutral-200 bg-white p-4 ${className}`}>{children}</div>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'gold' | 'green' | 'red' | 'blue' }) {
  const tones = {
    neutral: 'bg-neutral-100 text-neutral-700',
    gold: 'bg-amber-100 text-amber-900',
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-800',
    blue: 'bg-blue-100 text-blue-800',
  };
  return <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Spinner({ small }: { small?: boolean }) {
  const size = small ? 'h-4 w-4' : 'h-6 w-6';
  return <span aria-label="Loading" className={`${size} inline-block animate-spin rounded-full border-2 border-current border-t-transparent`} />;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-neutral-500">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorText({ error }: { error?: string | null }) {
  if (!error) return null;
  return <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>;
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-neutral-600">{subtitle}</p>}
    </div>
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2">
      <div className="text-sm font-semibold">{children}</div>
      {hint && <div className="text-xs text-neutral-500">{hint}</div>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 px-4 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {body && <p className="mt-1 text-sm text-neutral-600">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export const inputClass =
  'w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-base outline-none focus:border-cardinal focus:ring-2 focus:ring-red-100';
