// Person 1: app frame. Main screens get the FindOn header; inner screens get a title bar with back or close.
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { api, USE_MOCKS } from '@/lib/mock';
import { useSession, type Session } from './useSession';
import { Loading } from './ui';

const MAIN = ['/', '/my', '/notifications', '/desk'];

/** Sign-in is switched off for now. Set NEXT_PUBLIC_REQUIRE_SIGNIN=true to bring the login gate back. */
const REQUIRE_SIGNIN = process.env.NEXT_PUBLIC_REQUIRE_SIGNIN === 'true';

/** Title bar text for inner screens. Flows (found/lost) show "close" instead of "back". */
function innerScreen(path: string): { title: string; flow: boolean } | null {
  if (path === '/found/new') return { title: 'Report a found item', flow: true };
  if (path === '/lost/new') return { title: 'Report a lost item', flow: true };
  if (path.startsWith('/lost/')) return { title: 'Possible matches', flow: false };
  if (path.startsWith('/items/')) return { title: 'Found item', flow: false };
  if (path.startsWith('/claims/')) return { title: 'Claim', flow: false };
  return null;
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-white md:shadow-[0_0_0_1px_rgb(0_0_0/0.06)]">
      <Suspense fallback={<Loading />}>
        <Frame>{children}</Frame>
      </Suspense>
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { session, signOut } = useSession();
  const onLogin = path.startsWith('/login');
  const inner = innerScreen(path);

  useEffect(() => {
    if (REQUIRE_SIGNIN && session.status === 'out' && !onLogin) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [session.status, onLogin, path, router]);

  const ready = onLogin || !REQUIRE_SIGNIN || session.status === 'in';

  return (
    <>
      {inner && !onLogin ? (
        <TitleBar title={inner.title} flow={inner.flow} />
      ) : (
        <BrandBar session={onLogin ? { status: 'out' } : session} onSignOut={async () => { await signOut(); router.replace('/login'); }} />
      )}

      <main className="flex-1 px-4 pb-28 pt-4">{ready ? children : <Loading />}</main>

      {!onLogin && ready && (MAIN.includes(path) || path.startsWith('/lost/') && !inner?.flow) && <BottomNav path={path} />}
    </>
  );
}

function Mark() {
  return (
    <svg aria-hidden="true" width="30" height="30" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="16" fill="#990000" />
      <circle cx="28" cy="28" r="13" fill="none" stroke="#FFCC00" strokeWidth="6" />
      <path d="M38 38l12 12" stroke="#FFCC00" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}

function BrandBar({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-neutral-100 bg-white/90 px-4 backdrop-blur-md">
      <Link href="/" aria-label="FindOn home" className="flex min-h-11 items-center gap-2.5 rounded-xl pr-2">
        <Mark />
        <span className="text-[22px] font-extrabold leading-none tracking-tight">
          <span className="text-cardinal">Find</span><span className="text-gold">On</span>
        </span>
      </Link>
      <div className="flex items-center gap-2">
        {USE_MOCKS && (
          <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />Demo
          </span>
        )}
        {session.status === 'in' && (
          <>
            <button
              type="button" popoverTarget="account-menu" aria-label={`Account: ${session.email}`}
              className="on-cardinal flex h-11 w-11 items-center justify-center rounded-full bg-cardinal text-sm font-bold text-white ring-2 ring-white ring-offset-1 ring-offset-neutral-200"
            >
              {session.initials}
            </button>
            <div
              id="account-menu" popover="auto"
              className="inset-auto right-[max(1rem,calc((100vw-28rem)/2+1rem))] top-[4.25rem] m-0 w-64 rounded-[20px] border border-neutral-200 bg-white p-4 shadow-xl"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-600">Signed in as</p>
              <p className="mt-1 break-all text-[15px] font-medium">{session.email}</p>
              <button type="button" onClick={onSignOut} className="mt-3 min-h-11 w-full rounded-2xl border border-neutral-300 text-[15px] font-semibold hover:bg-neutral-50">
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}

function TitleBar({ title, flow }: { title: string; flow: boolean }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 grid h-14 grid-cols-[3rem_1fr_3rem] items-center border-b border-neutral-100 bg-white/90 px-2 backdrop-blur-md">
      {flow ? (
        <Link href="/" aria-label="Close and go home" className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-800 hover:bg-neutral-100">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </Link>
      ) : (
        <button type="button" onClick={() => (history.length > 1 ? router.back() : router.push('/'))} aria-label="Back" className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-800 hover:bg-neutral-100">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
      )}
      <p className="truncate text-center text-[17px] font-semibold">{title}</p>
      <span />
    </header>
  );
}

const icons: Record<string, ReactNode> = {
  '/': <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  '/my': <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M4 10h16M10 4v16" /></>,
  '/notifications': <><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
};

function BottomNav({ path }: { path: string }) {
  const [unread, setUnread] = useState(0);
  // Dot = alerts newer than the last time this browser opened the Alerts tab.
  useEffect(() => {
    let seen = 0;
    try { seen = Number(localStorage.getItem('findon-alerts-seen') ?? 0); } catch { /* storage blocked */ }
    api.notifications().then((n) => setUnread(n.filter((x) => new Date(x.created_at).getTime() > seen).length)).catch(() => {});
  }, [path]);

  const tabs = [
    { href: '/', label: 'Home' },
    { href: '/my', label: 'My stuff' },
    { href: '/notifications', label: 'Alerts' },
  ];
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-md grid-cols-3 border-t border-neutral-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
      {tabs.map((t) => {
        const active = t.href === '/' ? path === '/' || path.startsWith('/lost/') : path.startsWith(t.href);
        const badge = t.href === '/notifications' && unread > 0;
        return (
          <Link
            key={t.href} href={t.href} aria-current={active ? 'page' : undefined}
            aria-label={badge ? `${t.label}, ${unread} unread` : undefined}
            className={`flex h-16 flex-col items-center justify-center gap-1 text-xs ${active ? 'font-bold text-cardinal' : 'font-medium text-neutral-600'}`}
          >
            <span className={`relative flex h-8 w-14 items-center justify-center rounded-full transition ${active ? 'bg-red-50' : ''}`}>
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">{icons[t.href]}</svg>
              {badge && <span aria-hidden="true" className="absolute right-3 top-1 h-2 w-2 rounded-full bg-cardinal ring-2 ring-white" />}
            </span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
