// Person 1: sign in with a @usc.edu email and a one-time code. No passwords.
'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { USE_MOCKS } from '@/lib/mock';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Button, ErrorText, Label, Loading, inputClass } from '@/components/ui';

export default function LoginPage() {
  return <Suspense fallback={<Loading />}><Login /></Suspense>;
}

function Login() {
  const router = useRouter();
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
      } else {
        const { error } = await supabaseBrowser().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: 'email' });
        if (error) throw error;
      }
      router.replace(next);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <div className="pt-6">
      <h1 className="text-3xl font-extrabold tracking-tight"><span className="text-cardinal">Find</span><span className="text-amber-500">On</span></h1>
      <p className="mt-2 text-neutral-600">USC&apos;s lost and found. Sign in with your USC email.</p>

      <div className="mt-8 space-y-4">
        {!sent ? (
          <>
            <div>
              <Label>USC email</Label>
              <input type="email" inputMode="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ttrojan@usc.edu" className={inputClass} />
              {email && !validEmail && <p className="mt-1 text-xs text-neutral-500">Use your @usc.edu address.</p>}
            </div>
            <Button className="w-full text-base" disabled={!validEmail} loading={busy} onClick={sendCode}>Send me a code</Button>
          </>
        ) : (
          <>
            <div>
              <Label hint={`We sent a 6-digit code to ${email}.`}>Enter the code</Label>
              <input inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" className={`${inputClass} text-center text-2xl tracking-[0.4em]`} />
            </div>
            <Button className="w-full text-base" disabled={code.length !== 6} loading={busy} onClick={verify}>Sign in</Button>
            <button type="button" onClick={() => { setSent(false); setCode(''); }} className="w-full text-sm text-neutral-600">Use a different email</button>
          </>
        )}
        <ErrorText error={error} />
      </div>
    </div>
  );
}
