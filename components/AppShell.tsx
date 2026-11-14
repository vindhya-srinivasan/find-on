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
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-white md:shadow-[0_0_0_1px_rgb(0_0_0/0.06)]">
      <header className="sticky top-0 z-30 flex items-center justify-between bg-white/95 px-5 pb-3 pt-5 backdrop-blur">
        <Link href="/" aria-label="FindOn home" className="flex min-h-11 items-center text-2xl font-extrabold tracking-tight">
          <span className="text-cardinal">Find</span><span className="text-gold">On</span>
        </Link>
        <span className="flex items-center gap-2">
          {USE_MOCKS && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">Sample data</span>}
          <span className="text-[13px] font-medium text-neutral-500">USC Lost &amp; Found</span>
        </span>
      </header>
      <main className="flex-1 px-4 pb-28 pt-1">{children}</main>
      <Suspense fallback={null}><BottomNav /></Suspense>
    </div>
  );
}

function BottomNav() {
  const path = usePathname();
  if (path.startsWith('/login')) return null;
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-md grid-cols-3 border-t border-neutral-100 bg-white pb-[env(safe-area-inset-bottom)]">
      {tabs.map((t) => {
        const active = t.href === '/'
          ? path === '/' || path.startsWith('/found') || path.startsWith('/lost') || path.startsWith('/items')
          : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined} className={`flex h-[3.25rem] items-center justify-center text-sm ${active ? 'font-bold text-cardinal' : 'font-medium text-neutral-500'}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
