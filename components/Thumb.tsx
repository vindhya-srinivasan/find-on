// Person 1: item thumbnail. Public listings are always shown blurred.
/* eslint-disable @next/next/no-img-element */
export function Thumb({ src, blurred = true, size = 'md', label }:
  { src?: string | null; blurred?: boolean; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const dims = { sm: 'h-14 w-14', md: 'h-20 w-20', lg: 'h-56 w-full' }[size];
  return (
    <div className={`${dims} relative shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-neutral-200 to-neutral-300`}>
      {src ? (
        <img src={src} alt={label ?? 'Item photo'} className={`h-full w-full object-cover ${blurred ? 'scale-110 blur-md' : ''}`} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] font-medium uppercase tracking-wide text-neutral-500">
          {label ?? 'Photo'}
        </div>
      )}
    </div>
  );
}
