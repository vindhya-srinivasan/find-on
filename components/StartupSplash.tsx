// Person 1: startup splash (FIGHT ON! hand -> FIND ON! magnifier, 2.6 s) once per full page load.
// Lives in the root layout, so it plays before the sign-in screen and client-side navigation never remounts it.
// The app (and the redirect to /login) loads underneath in parallel.
'use client';

import { useEffect, useRef, useState } from 'react';

const PLAY_MS = 2600; // animation length (156 frames at 60 fps)
const FADE_MS = 160;
const MAX_MS = 3200; // fail open: never block the app longer than this from mount

export function StartupSplash() {
  const [phase, setPhase] = useState<'show' | 'fade' | 'gone'>('show');
  const img = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const timers: number[] = [];
    // Login finishes with a full reload (app/(pages)/login/page.tsx); the user just saw the splash before signing in.
    let fromLogin = false;
    try {
      const ref = new URL(document.referrer);
      fromLogin = ref.origin === location.origin && ref.pathname.startsWith('/login');
    } catch {
      // no referrer
    }
    if (fromLogin) {
      timers.push(window.setTimeout(() => setPhase('gone'), 0));
      return () => timers.forEach(clearTimeout);
    }
    const finish = () => {
      setPhase((p) => (p === 'show' ? 'fade' : p));
      timers.push(window.setTimeout(() => setPhase('gone'), FADE_MS));
    };
    let started = false;
    const start = () => {
      if (!started) timers.push(window.setTimeout(finish, PLAY_MS));
      started = true;
    };
    const fail = () => setPhase('gone');
    const el = img.current;
    // The image may already be loaded (or failed) before hydration, so check before listening.
    if (el?.complete) {
      if (el.naturalWidth) start();
      else timers.push(window.setTimeout(fail, 0));
    }
    el?.addEventListener('load', start);
    el?.addEventListener('error', fail);
    timers.push(window.setTimeout(finish, MAX_MS));
    return () => {
      timers.forEach(clearTimeout);
      el?.removeEventListener('load', start);
      el?.removeEventListener('error', fail);
    };
  }, []);

  if (phase === 'gone') return null;
  return (
    <div
      id="findon-splash"
      role="status"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, background: '#990000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: phase === 'fade' ? 0 : 1, transition: `opacity ${FADE_MS}ms ease-out`,
      }}
    >
      {/* Reduced motion: never shown (CSS, so no flash before JS). No JS at all: a CSS-only fade removes it after MAX_MS. */}
      <style>{`
        @media (prefers-reduced-motion: reduce) { #findon-splash { display: none !important; } }
        #findon-splash { animation: findon-splash-out ${FADE_MS}ms ease-out ${MAX_MS + 300}ms forwards; }
        @keyframes findon-splash-out { to { opacity: 0; visibility: hidden; } }
      `}</style>
      {/* Animated SVG with an embedded PNG and SMIL; next/image would rasterize it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={img}
        src="/startup/fight-on-hand-to-magnifier.svg"
        width={360}
        height={360}
        alt="FindOn is starting: FIGHT ON! victory hand turning into a FIND ON! magnifier"
        style={{ width: 'min(360px, 80vw)', height: 'auto', aspectRatio: '1 / 1' }}
      />
    </div>
  );
}
