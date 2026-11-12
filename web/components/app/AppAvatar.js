import { Check } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { avatarSrc, initialsOf } from '@/lib/avatar';

const SIZES = {
  sm: { box: 'size-8', text: 'text-[0.8125rem]', badge: 'size-3.5 -bottom-0.5 -right-0.5', check: 'size-2' },
  md: { box: 'size-11', text: 'text-[1rem]', badge: 'size-4 -bottom-0.5 -right-0.5', check: 'size-2.5' },
  lg: { box: 'size-16', text: 'text-[1.5rem]', badge: 'size-5 bottom-0 right-0', check: 'size-3' },
};

/**
 * The person's mark in the app (Compte screens): their own photo when one
 * really exists (an agent's upload), otherwise their initials in the app's
 * serif on royal blue, never a stock face. A white ring lifts it off the grey
 * page. `verified` adds the green check badge — only for a verification level
 * the team granted (the caller decides); `verifiedLabel` is what a screen
 * reader hears for it.
 */
export default function AppAvatar({ name, src = null, size = 'lg', verified = false, verifiedLabel = '', className = '' }) {
  const s = SIZES[size] || SIZES.lg;
  const initials = initialsOf(name);
  const photo = avatarSrc(src);

  return (
    <span className={cn('relative inline-flex flex-none', className)}>
      <Avatar className={cn(s.box, size === 'sm' ? 'ring-2 ring-surface' : 'ring-4 ring-surface shadow-sm')}>
        {photo ? <AvatarImage src={photo} alt={name || ''} /> : null}
        <AvatarFallback className="bg-blue text-white" aria-label={name || undefined}>
          {initials ? (
            <span className={cn('u-app-serif leading-none', s.text)} aria-hidden="true">
              {initials}
            </span>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-1/2 fill-none stroke-current" strokeWidth="1.75" strokeLinecap="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
            </svg>
          )}
        </AvatarFallback>
      </Avatar>
      {verified ? (
        <span
          role="img"
          aria-label={verifiedLabel}
          className={cn('absolute flex items-center justify-center rounded-full bg-green text-white ring-2 ring-surface', s.badge)}
        >
          <Check strokeWidth={3.5} className={s.check} aria-hidden="true" />
        </span>
      ) : null}
    </span>
  );
}
