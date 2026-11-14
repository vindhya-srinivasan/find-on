// Person 1: phone-width app frame with header and bottom navigation.
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { USE_MOCKS } from '@/lib/mock';

// Reporting lives on Home (two big buttons), so the nav stays to three places.
const tabs = [
  { href: '/', label: 'Home' },
  { href: '/my', label: 'My stuff' },
  { href: '/notifications', label: 'Alerts' },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-neutral-50">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
        <Link href="/" className="text-lg font-extrabold tracking-tight">
          <span className="text-cardinal">Find</span><span className="text-amber-500">On</span>
        </Link>
        {USE_MOCKS && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">Sample data</span>}
      </header>
      <main className="flex-1 px-4 pb-28 pt-5">{children}</main>
      <Suspense fallback={null}><BottomNav /></Suspense>
    </div>
  );
}

function BottomNav() {
  const path = usePathname();
  if (path.startsWith('/login')) return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-md grid-cols-3 border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)]">
      {tabs.map((t) => {
        const active = t.href === '/'
          ? path === '/' || path.startsWith('/found') || path.startsWith('/lost') || path.startsWith('/items')
          : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={`flex h-[3.25rem] items-center justify-center text-sm font-semibold ${active ? 'text-cardinal' : 'text-neutral-500'}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
