// Person 1: the things waiting on the user, shown as short rows under the two big choices on Home.
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { MyItems } from '@/types';
import { api } from '@/lib/mock';

type Todo = { text: string; cta: string; href: string; urgent: boolean };

function todos(me: MyItems): Todo[] {
  const out: Todo[] = [];
  for (const c of me.claims) {
    if (c.status === 'awaiting_answers') out.push({ text: `Finish claiming the ${c.item.category}`, cta: 'Open', href: `/claims/${c.id}`, urgent: true });
    if (c.status === 'likely_owner' || c.status === 'approved') out.push({ text: `You're verified. Pick up the ${c.item.category}`, cta: 'Code', href: `/claims/${c.id}`, urgent: true });
  }
  for (const f of me.found) {
    if (f.pending_claims.some((c) => c.status === 'needs_review')) out.push({ text: `Someone claimed the ${f.category} you found`, cta: 'Review', href: '/my', urgent: true });
    if (f.status === 'en_route_to_desk') out.push({ text: `Drop the ${f.category} at DPS, code ${f.item_code}`, cta: 'Open', href: '/my', urgent: false });
  }
  for (const l of me.lost) {
    if (l.status === 'open' && l.match_count > 0) out.push({ text: `A match for your ${l.category} is waiting`, cta: 'Open', href: `/lost/${l.id}`, urgent: true });
  }
  return out;
}

export function Attention() {
  const [list, setList] = useState<Todo[]>([]);
  useEffect(() => { api.myItems().then((m) => setList(todos(m))).catch(() => {}); }, []);
  if (!list.length) return null;
  return (
    <section aria-label="Waiting on you" className="flex flex-col gap-2">
      {list.slice(0, 2).map((t) => (
        <Link key={t.href + t.text} href={t.href}
          className="flex min-h-12 items-center gap-3 rounded-[20px] border-[1.5px] border-neutral-200 bg-white px-4 py-3.5">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${t.urgent ? 'bg-cardinal' : 'bg-amber-400'}`} />
          <span className="flex-1 text-[15px] font-medium">{t.text}</span>
          <span className="text-[15px] font-bold text-cardinal">{t.cta}</span>
        </Link>
      ))}
    </section>
  );
}
