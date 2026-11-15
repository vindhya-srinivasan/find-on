// Person 1: who is claiming and the photos they sent, shown to the finder or desk reviewing a claim. Never hidden details.
import type { ClaimDetail } from '@/types';
import { Thumb } from '@/components/Thumb';

export function ReviewExtras({ claim }: { claim: ClaimDetail }) {
  const { claimant_name, proof_photo_url, owner_photo_url } = claim;
  if (!claimant_name && !proof_photo_url && !owner_photo_url) return null;
  const photos = [
    { url: proof_photo_url, open: 'Open proof photo', caption: 'Proof photo' },
    { url: owner_photo_url, open: 'Open their lost-report photo', caption: 'Photo from their lost report' },
  ].filter((p) => p.url);
  return (
    <div className="space-y-3">
      {claimant_name && <p className="text-sm">Claimed by <span className="font-semibold">{claimant_name}</span></p>}
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {photos.map((p) => (
            <div key={p.caption} className="w-20">
              <a href={p.url} target="_blank" rel="noopener noreferrer" aria-label={p.open} className="block">
                <Thumb src={p.url} blurred={false} label={p.caption} />
              </a>
              <p className="mt-1 text-xs text-neutral-500">{p.caption}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
