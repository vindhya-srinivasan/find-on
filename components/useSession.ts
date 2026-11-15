// Person 1: who is signed in. Sample-data mode keeps a pretend session in this browser;
// real mode asks Supabase.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { USE_MOCKS } from '@/lib/mock';
import { supabaseBrowser } from '@/lib/supabase/client';

const MOCK_KEY = 'findon-mock-user';

export type Session =
  | { status: 'loading' }
  | { status: 'out' }
  | { status: 'in'; email: string; initials: string };

function initialsOf(email: string) {
  const name = email.split('@')[0].replace(/[^a-z]/gi, '');
  return (name.slice(0, 2) || 'U').toUpperCase();
}

export function mockSignIn(email: string) {
  try { localStorage.setItem(MOCK_KEY, email.toLowerCase()); } catch { /* storage blocked */ }
}

export function useSession() {
  const [session, setSession] = useState<Session>({ status: 'loading' });

  useEffect(() => {
    if (USE_MOCKS) {
      let email: string | null = null;
      try { email = localStorage.getItem(MOCK_KEY); } catch { /* storage blocked */ }
      // Reading browser storage once on mount is the point of this effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSession(email ? { status: 'in', email, initials: initialsOf(email) } : { status: 'out' });
      return;
    }
    const sb = supabaseBrowser();
    const apply = (email?: string | null) =>
      setSession(email ? { status: 'in', email, initials: initialsOf(email) } : { status: 'out' });
    sb.auth.getSession().then(({ data }) => apply(data.session?.user.email));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => apply(s?.user.email));
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    if (USE_MOCKS) {
      try { localStorage.removeItem(MOCK_KEY); } catch { /* storage blocked */ }
    } else {
      await supabaseBrowser().auth.signOut();
    }
    setSession({ status: 'out' });
  }, []);

  return { session, signOut };
}
