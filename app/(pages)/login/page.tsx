// Person 1: sign in with a @usc.edu email and a one-time code. No passwords.
'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { USE_MOCKS } from '@/lib/mock';
import { mockSignIn } from '@/components/useSession';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Button, ErrorText, Label, Loading, inputClass } from '@/components/ui';

export default function LoginPage() {
  return <Suspense fallback={<Loading />}><Login /></Suspense>;
}

function Login() {
  const next = useSearchParams().get('next') || '/';
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validEmail = /^[^\s@]+@usc\.edu$/i.test(email.trim());

  async function sendCode() {
    setBusy(true); setError(null);
    try {
      if (!USE_MOCKS) {
        const { error } = await supabaseBrowser().auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true } });
        if (error) throw error;
      }
      setSent(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function verify() {
    setBusy(true); setError(null);
    try {
      if (USE_MOCKS) {
        if (code !== '123456') throw new Error('Wrong code. In sample-data mode the code is 123456.');
        mockSignIn(email.trim());
      } else {
        const { error } = await supabaseBrowser().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: 'email' });
        if (error) throw error;
      }
      // Full reload so the header and gate pick up the new session.
      window.location.replace(next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <div className="pt-6">
      <h1 className="text-[28px] font-bold tracking-tight">Sign in</h1>
      <p className="mt-2 text-neutral-600">USC&apos;s lost and found. Use your USC email, no password needed.</p>

      <div className="mt-8 space-y-4">
        {!sent ? (
          <>
            <div>
              <Label htmlFor="email">USC email</Label>
              <input id="email" type="email" inputMode="email" autoComplete="email" enterKeyHint="send" aria-invalid={!!email && !validEmail} aria-describedby="email-help" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ttrojan@usc.edu" className={inputClass} />
              <p id="email-help" className="mt-1 text-sm text-neutral-600">{email && !validEmail ? 'Use your @usc.edu address.' : 'Only @usc.edu addresses can sign in.'}</p>
            </div>
            <Button className="w-full text-base" disabled={!validEmail} loading={busy} onClick={sendCode}>Send me a code</Button>
          </>
        ) : (
          <>
            <div>
              <Label htmlFor="code" hint={`We sent a 6-digit code to ${email}.`}>Enter the code</Label>
              <input id="code" inputMode="numeric" autoComplete="one-time-code" enterKeyHint="go" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" className={`${inputClass} text-center text-2xl tracking-[0.4em]`} />
            </div>
            <Button className="w-full text-base" disabled={code.length !== 6} loading={busy} onClick={verify}>Sign in</Button>
            <button type="button" onClick={() => { setSent(false); setCode(''); }} className="min-h-11 w-full rounded-xl text-sm font-medium text-neutral-700">Use a different email</button>
          </>
        )}
        <ErrorText error={error} />
      </div>
    </div>
  );
}
