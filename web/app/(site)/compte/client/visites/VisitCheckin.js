'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ThumbsDown, ThumbsUp, UserX } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n/client';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { checkinViewingAction } from '../actions';

const CHOICES = [
  { value: 'GOOD', icon: ThumbsUp, labelKey: 'account.agenda.checkin.GOOD' },
  { value: 'BAD', icon: ThumbsDown, labelKey: 'account.agenda.checkin.BAD' },
  { value: 'AGENT_ABSENT', icon: UserX, labelKey: 'account.agenda.checkin.AGENT_ABSENT' },
];

/**
 * "Comment s'est passée la visite ?" — three taps, the same engine check-in
 * as the WhatsApp question and the Messages tab (checkinViewingAction). The
 * engine refuses it before the agreed time; the page only offers it after
 * (lib/clientPortalView.js needsCheckin). The choice shows at once; a failure
 * puts the buttons back.
 */
export default function VisitCheckin({ viewingId }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState(null);

  function choose(value) {
    setChosen(value);
    startTransition(async () => {
      let result;
      try {
        result = await checkinViewingAction(viewingId, value);
      } catch {
        result = { ok: false, error: t('account.agenda.actionFailed') };
      }
      if (result?.ok) {
        showToast({ type: 'success', message: result.message });
        router.refresh();
      } else {
        setChosen(null);
        showToast({ type: 'error', message: result?.error || t('account.agenda.actionFailed') });
      }
    });
  }

  return (
    <div>
      <p className="u-title-sub mb-2 text-ink">{t('account.agenda.checkinQuestion')}</p>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('account.agenda.checkinQuestion')}>
        {CHOICES.map(({ value, icon: Icon, labelKey }) => {
          const on = chosen === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              disabled={pending || (chosen != null && !on)}
              onClick={() => choose(value)}
              className={cn(
                'u-press flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl text-[0.75rem] font-bold disabled:opacity-60',
                on ? 'bg-blue text-white' : 'text-ink shadow-[inset_0_0_0_1.5px_var(--ink-25)]',
              )}
            >
              <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
              {t(labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
