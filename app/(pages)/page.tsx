// Person 1: home. Two giant choices fill the screen; anything waiting on you sits under them.
import Link from 'next/link';
import { Attention } from '@/components/Attention';

export default function Home() {
  return (
    <div className="flex min-h-[calc(100dvh-10.5rem)] flex-col gap-3">
      <Link
        href="/lost/new"
        className="flex min-h-48 flex-1 flex-col justify-between rounded-[28px] bg-cardinal p-6 text-white transition active:scale-[0.98]"
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-white/15">
          <svg aria-hidden="true" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        </span>
        <span className="flex flex-col gap-1.5">
          <span className="text-[34px] font-extrabold leading-none tracking-tight">I lost<br />something</span>
          <span className="text-base text-red-100">Tell us what it looks like. We&apos;ll alert you when it turns up.</span>
        </span>
      </Link>

      <Link
        href="/found/new"
        className="flex min-h-48 flex-1 flex-col justify-between rounded-[28px] bg-gold p-6 text-neutral-900 transition active:scale-[0.98]"
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-black/[0.08]">
          <svg aria-hidden="true" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
        </span>
        <span className="flex flex-col gap-1.5">
          <span className="text-[34px] font-extrabold leading-none tracking-tight">I found<br />something</span>
          <span className="text-base text-neutral-800">Snap one photo. We find the owner and check it&apos;s really theirs.</span>
        </span>
      </Link>

      <Attention />
    </div>
  );
}
