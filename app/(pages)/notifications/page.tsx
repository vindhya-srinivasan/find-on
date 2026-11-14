// Person 1: alerts. Tapping one goes straight to the thing to do.
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { NotificationItem } from '@/types';
import { api } from '@/lib/mock';
import { timeAgo } from '@/components/format';
import { EmptyState, ErrorText, Loading, PageTitle } from '@/components/ui';

export default function NotificationsPage() {
  const [list, setList] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.notifications().then(setList).catch((e) => setError(e.message)); }, []);

  return (
    <div>
      <PageTitle title="Alerts" />
      <ErrorText error={error} />
      {!list && !error && <Loading />}
      {list && list.length === 0 && <EmptyState title="No alerts yet" body="We'll let you know when there's a match or an update on your items." />}
      <div className="space-y-2">
        {list?.map((n) => (
          <Link key={n.id} href={n.link} className={`flex items-start gap-3 rounded-2xl border bg-white p-4 ${n.read ? 'border-neutral-200' : 'border-cardinal/40'}`}>
            {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cardinal" aria-label="Unread" />}
            <div>
              <p className="text-sm">{n.text}</p>
              <p className="mt-1 text-xs text-neutral-500">{timeAgo(n.created_at)}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
