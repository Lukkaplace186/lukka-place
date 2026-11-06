'use client';

import { unreadLabel } from '@/lib/chatRules';
import { cn } from '@/lib/utils';

/**
 * The royal-blue unread count, "1" to "99+". Nothing at 0. `label` is the
 * screen reader's sentence ("3 non lus"); the digits themselves are hidden
 * from it so it is not read twice.
 */
export default function UnreadBadge({ count, label, className = '' }) {
  if (!count) return null;
  return (
    <span
      className={cn(
        'u-tabular inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-blue px-[5px] text-[0.6875rem] font-bold leading-none text-white',
        className,
      )}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{unreadLabel(count)}</span>
    </span>
  );
}
