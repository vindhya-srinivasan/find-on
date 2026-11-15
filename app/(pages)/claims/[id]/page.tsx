// Person 1: verify ownership, then see how to get the item back.
'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { ChatMessage, ClaimDetail } from '@/types';
import { api } from '@/lib/mock';
import { FlowBottomSpace, PrimaryAction, StickyAction } from '@/components/Flow';
import { Button, Card, ErrorText, LinkButton, Loading, PageTitle, inputClass } from '@/components/ui';
import { shortDate, timeAgo } from '@/components/format';
import { Thumb } from '@/components/Thumb';
import { useBuildings } from '@/components/useBuildings';

export default function ClaimPageRoute() {
  return <Suspense fallback={<Loading />}><ClaimPage /></Suspense>;
}

function ClaimPage() {
  const { id } = useParams<{ id: string }>();
  const [claim, setClaim] = useState<ClaimDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.claim(id).then(setClaim).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (error && !claim) return <ErrorText error={error} />;
  if (!claim) return <Loading />;

  if (claim.viewer !== 'claimant') return <Review claim={claim} onDone={load} />;
  switch (claim.status) {
    case 'awaiting_answers': return <Quiz claim={claim} onDone={load} />;
    case 'likely_owner':
    case 'approved': return <Verified claim={claim} />;
    case 'needs_review': return claim.return_details
      ? <InPersonCheck claim={claim} />
      : <Status title="A person will check your answers" body="Your answers were close but need a quick human check. We'll alert you as soon as it's decided." />;
    case 'rejected': return (
      <Status
        title="We couldn’t verify this one"
        body={`Your answers didn't match the details we have.${claim.retry_after ? ` You can try again after ${new Date(claim.retry_after).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : ''} If it isn't yours, we'll keep watching for your item.`}
      />
    );
    case 'returned': return <Status title="It’s back with you" body="This item has been returned. Thanks for using FindOn." icon="✓" />;
  }
}

function Quiz({ claim, onDone }: { claim: ClaimDetail; onDone: () => void }) {
  const { nameOf } = useBuildings();
  const questions = claim.questions ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = questions.every((q) => (answers[q.id] ?? '').trim().length >= 2);

  async function submit() {
    setSending(true);
    setError(null);
    try {
      await api.submitAnswers(claim.id, questions.map((q) => ({ question_id: q.id, answer: answers[q.id].trim() })));
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Thumb src={claim.item.blurred_thumb_url} size="sm" label={claim.item.category} />
        <div>
          <p className="text-[17px] font-bold capitalize">{claim.item.color} {claim.item.category}</p>
          <p className="text-[13px] text-neutral-600">Found at {nameOf(claim.item.found_building_id)} · {shortDate(claim.item.found_date)}</p>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Prove it&apos;s yours</h1>
        <p className="mt-1.5 text-sm text-neutral-600">Answer from memory. You get one try, so describe what you&apos;re sure of.</p>
      </div>

      {questions.map((q, i) => (
        <div key={q.id} className="flex flex-col gap-2">
          <label htmlFor={`a-${q.id}`} className="text-[15px] font-semibold">
            <span className="text-cardinal">{i + 1}.</span> {q.question}
          </label>
          <textarea
            id={`a-${q.id}`} rows={2} value={answers[q.id] ?? ''}
            onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
            placeholder="Type your answer" aria-describedby={q.hint ? `h-${q.id}` : undefined}
            className={`${inputClass} resize-none [field-sizing:content] min-h-20`}
          />
          {q.hint && <p id={`h-${q.id}`} className="text-sm text-neutral-600">{q.hint}</p>}
        </div>
      ))}

      <div className="flex items-start gap-2.5 rounded-[14px] bg-[#FAF7F2] px-3.5 py-3">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7A6A55" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-px shrink-0"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
        <p className="text-[13px] text-[#5A4E3E]">The photo stays blurred until you pass. Your answers are only used to confirm it&apos;s yours.</p>
      </div>

      <ErrorText error={error} />
      <FlowBottomSpace />
      <StickyAction>
        <PrimaryAction disabled={!complete} loading={sending} onClick={submit}>{sending ? 'Checking…' : 'Submit answers'}</PrimaryAction>
      </StickyAction>
    </div>
  );
}

function Verified({ claim }: { claim: ClaimDetail }) {
  const r = claim.return_details;
  const desk = r?.method === 'desk';
  return (
    <div className="space-y-5">
      <div className="pt-2 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl text-green-700">✓</div>
        <h1 className="text-2xl font-bold">You&apos;re verified</h1>
        <p className="mt-1 text-sm text-neutral-600">{desk ? 'Show this code at the desk to collect it.' : 'Show this code to the finder when you meet.'}</p>
      </div>

      <Card className="text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Pickup code</p>
        <p className="mt-1 text-5xl font-bold tracking-[0.2em]">{claim.pickup_code}</p>
      </Card>

      {desk ? (
        <Card>
          <p className="font-semibold">{r?.desk_name}</p>
          {r?.desk_hours && <p className="text-sm text-neutral-600">{r.desk_hours}</p>}
          <p className="mt-2 text-sm text-neutral-600">Bring your USC ID.</p>
        </Card>
      ) : (
        <>
          <Card>
            <p className="font-semibold">Found by {r?.finder_name}</p>
            {r?.finder_availability && <p className="text-sm text-neutral-600">Usually free: {r.finder_availability}</p>}
            <p className="mt-2 rounded-xl bg-cream px-3 py-2 text-sm text-[#5A4E3E]">Meet in a public, staffed place during the day, like a building lobby or the DPS office.</p>
          </Card>
          <Chat claimId={claim.id} />
        </>
      )}
    </div>
  );
}

/** Borderline claim: go where the item is and get checked in person. No pickup code until the desk or finder approves. */
function InPersonCheck({ claim }: { claim: ClaimDetail }) {
  const r = claim.return_details!;
  const desk = r.method === 'desk';
  const onTheWay = claim.item.status === 'en_route_to_desk';
  return (
    <div className="space-y-5">
      <div className="pt-2 text-center">
        <h1 className="text-2xl font-bold">Check it in person</h1>
        <p className="mx-auto mt-1 max-w-xs text-sm text-neutral-600">
          {desk
            ? 'Your answers were close. Go to the desk and the staff will look at the item with you.'
            : 'Your answers were close. Meet the finder and they will check it with you.'}
        </p>
      </div>
      {desk ? (
        <Card>
          <p className="font-semibold">{r.desk_name ?? 'DPS Lost & Found'}</p>
          {r.desk_hours && <p className="text-sm text-neutral-600">{r.desk_hours}</p>}
          <p className="mt-2 text-sm text-neutral-600">
            {onTheWay ? 'It is on its way to the desk. We will alert you when it arrives. ' : ''}Bring your USC ID. Once staff confirm it&apos;s yours, you&apos;ll get a pickup code.
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <p className="font-semibold">{r.finder_name ? `${r.finder_name} has it` : 'The finder has it'}</p>
            {r.finder_availability && <p className="text-sm text-neutral-600">Usually free: {r.finder_availability}</p>}
            <p className="mt-2 text-sm text-neutral-600">Once they confirm it&apos;s yours, you&apos;ll get a pickup code to finish the handoff.</p>
            <p className="mt-2 rounded-xl bg-cream px-3 py-2 text-sm text-[#5A4E3E]">Meet in a public, staffed place during the day, like a building lobby or the DPS office.</p>
          </Card>
          <Chat claimId={claim.id} />
        </>
      )}
    </div>
  );
}

function Chat({ claimId }: { claimId: string }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  useEffect(() => {
    const tick = () => api.messages(claimId).then(setMsgs).catch(() => {});
    tick();
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
  }, [claimId]);

  async function send() {
    if (!text.trim()) return;
    setMsgs(await api.sendMessage(claimId, text.trim()));
    setText('');
  }

  return (
    <Card>
      <p className="mb-3 font-semibold">Plan the handoff</p>
      <div className="max-h-64 space-y-2 overflow-y-auto overscroll-contain" aria-live="polite" aria-label="Messages">
        {msgs.length === 0 && <p className="text-sm text-neutral-600">Say hi and suggest a time and place.</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.mine ? 'bg-cardinal text-white' : 'bg-neutral-100'}`}>
              {m.body}
              <div className={`mt-0.5 text-[11px] ${m.mine ? 'text-red-100' : 'text-neutral-600'}`}>{m.mine ? 'You' : m.sender_name} · {timeAgo(m.created_at)}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} aria-label="Message the finder" autoComplete="off" enterKeyHint="send" placeholder="Message" className={inputClass} />
        <Button onClick={send} disabled={!text.trim()}>Send</Button>
      </div>
    </Card>
  );
}

/** What the finder or desk staff see when a claim needs a human decision. */
function Review({ claim, onDone }: { claim: ClaimDetail; onDone: () => void }) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  async function decide(d: 'approve' | 'reject') {
    setBusy(d);
    await api.reviewClaim(claim.id, d).catch(() => {});
    onDone();
  }
  return (
    <div className="space-y-5">
      <PageTitle title="Is this the owner?" subtitle={`Someone claimed the ${claim.item.color} ${claim.item.category}. Compare their answers with what you know about the item.`} />
      {typeof claim.score === 'number' && (
        <Card>
          <p className="text-sm"><span className="font-semibold">Match score: {claim.score}/100.</span> {claim.reason}</p>
        </Card>
      )}
      <div className="space-y-3">
        {claim.answers?.map((a, i) => (
          <Card key={i}>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{a.question}</p>
            <p className="mt-1">{a.answer}</p>
          </Card>
        ))}
      </div>
      {claim.status === 'needs_review' && claim.viewer === 'finder' && (
        <p className="rounded-xl bg-cream px-3 py-2 text-sm text-[#5A4E3E]">Not sure? Meet them somewhere public and check together, or drop the item at DPS and let the desk decide.</p>
      )}
      {claim.status === 'needs_review' ? (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="danger" loading={busy === 'reject'} onClick={() => decide('reject')}>Not the owner</Button>
          <Button loading={busy === 'approve'} onClick={() => decide('approve')}>Approve</Button>
        </div>
      ) : (
        <p className="text-sm text-neutral-600">Decision made: {claim.status.replace('_', ' ')}.</p>
      )}
    </div>
  );
}

function Status({ title, body, icon }: { title: string; body: string; icon?: string }) {
  return (
    <div className="pt-6 text-center">
      {icon && <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl text-green-700">{icon}</div>}
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mx-auto mt-2 max-w-xs text-sm text-neutral-600">{body}</p>
      <div className="mx-auto mt-8 max-w-xs"><LinkButton href="/" variant="secondary" className="w-full">Back to home</LinkButton></div>
    </div>
  );
}
