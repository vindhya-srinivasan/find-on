// Person 1: "Needs your attention": the one thing the user should do next, shown at the top of Home.
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { MyItems } from '@/types';
import { api } from '@/lib/mock';

type Todo = { text: string; cta: string; href: string; tone: 'red' | 'gold' };

function todos(me: MyItems): Todo[] {
  const out: Todo[] = [];
  for (const c of me.claims) {
    if (c.status === 'awaiting_answers') out.push({ text: `Finish verifying the ${c.item.category} you claimed`, cta: 'Answer questions', href: `/claims/${c.id}`, tone: 'red' });
    if ((c.status === 'likely_owner' || c.status === 'approved')) out.push({ text: `You're verified for the ${c.item.category}. Pick it up.`, cta: 'See pickup code', href: `/claims/${c.id}`, tone: 'red' });
  }
  for (const f of me.found) {
    if (f.pending_claims.some((c) => c.status === 'needs_review')) out.push({ text: `Someone claimed the ${f.category} you found`, cta: 'Review claim', href: '/my', tone: 'red' });
    if (f.status === 'en_route_to_desk') out.push({ text: `Drop the ${f.category} at DPS and show code ${f.item_code}`, cta: 'Show code', href: '/my', tone: 'gold' });
  }
  for (const l of me.lost) {
    if (l.status === 'open' && l.match_count > 0) out.push({ text: `${l.match_count} possible match${l.match_count > 1 ? 'es' : ''} for your ${l.category}`, cta: 'Check matches', href: `/lost/${l.id}`, tone: 'gold' });
  }
  return out;
}

export function Attention() {
  const [list, setList] = useState<Todo[]>([]);
  useEffect(() => { api.myItems().then((m) => setList(todos(m))).catch(() => {}); }, []);
  if (!list.length) return null;
  return (
    <section aria-label="Needs your attention" className="space-y-2">
      {list.slice(0, 3).map((t) => (
        <Link key={t.href + t.text} href={t.href}
          className={`flex items-center justify-between gap-3 rounded-2xl border-l-4 bg-white p-4 shadow-sm ${t.tone === 'red' ? 'border-cardinal' : 'border-amber-400'}`}>
          <span className="text-sm font-medium">{t.text}</span>
          <span className="shrink-0 text-sm font-semibold text-cardinal">{t.cta} →</span>
        </Link>
      ))}
    </section>
  );
}
