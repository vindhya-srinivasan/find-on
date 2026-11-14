// Person 1: one public listing in a list.
import Link from 'next/link';
import type { PublicFoundItem } from '@/types';
import { Thumb } from './Thumb';
import { Badge } from './ui';
import { itemStatusLabel, shortDate } from './format';

export function ItemCard({ item, buildingName, href, reason, score }:
  { item: PublicFoundItem; buildingName: string; href: string; reason?: string; score?: number }) {
  return (
    <Link href={href} className="flex gap-3 rounded-2xl border border-neutral-200 bg-white p-3 transition hover:border-neutral-400">
      <Thumb src={item.blurred_thumb_url} label={item.category} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold leading-snug capitalize">{item.color} {item.category}</p>
          {typeof score === 'number' && <Badge tone="gold">{score}% match</Badge>}
        </div>
        <p className="text-sm text-neutral-600">{buildingName} · {shortDate(item.found_date)}</p>
        {reason ? (
          <p className="mt-1 text-sm text-neutral-700">{reason}</p>
        ) : (
          <div className="mt-1"><Badge>{itemStatusLabel[item.status]}</Badge></div>
        )}
      </div>
    </Link>
  );
}
