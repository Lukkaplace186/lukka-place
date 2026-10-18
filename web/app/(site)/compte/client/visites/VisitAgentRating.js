'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Star } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n/client';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { rateAgentAction } from '../actions';

const STARS = [1, 2, 3, 4, 5];

/**
 * "Notez l'agent" — 1 to 5 stars about the AGENT, after the check-in said the
 * visit happened (lib/clientPortalView.js needsAgentRating). The same engine
 * rating as the WhatsApp question (services/agentReviews.js): one per visit,
 * the comment optional and published only after moderation. Once rated, the
 * card shows the customer's own note and nothing to change.
 */
export default function VisitAgentRating({ viewingId, agentName, rated = null }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [saved, setSaved] = useState(rated);

  if (saved != null) {
    return <p className="text-sm font-semibold text-ink">{t('account.agenda.rating.yours', { stars: saved })}</p>;
  }

  function submit() {
    if (!stars) return;
    startTransition(async () => {
      let result;
      try {
        result = await rateAgentAction(viewingId, stars, comment);
      } catch {
        result = { ok: false, error: t('account.agenda.rating.failed') };
      }
      if (result?.ok) {
        setSaved(stars);
        showToast({ type: 'success', message: result.message });
        router.refresh();
      } else {
        showToast({ type: 'error', message: result?.error || t('account.agenda.rating.failed') });
      }
    });
  }

  const question = agentName
    ? t('account.agenda.rating.questionNamed', { name: agentName })
    : t('account.agenda.rating.question');

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <p className="u-title-sub text-ink">{question}</p>
        <p className="mt-0.5 text-xs text-ink-45">{t('account.agenda.rating.hint')}</p>
      </div>
      <div className="flex gap-1" role="radiogroup" aria-label={question}>
        {STARS.map((value) => {
          const on = value <= stars;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={stars === value}
              aria-label={t('account.agenda.rating.star', { count: value })}
              disabled={pending}
              onClick={() => setStars(value)}
              className="u-press grid h-11 w-11 place-items-center rounded-full disabled:opacity-60"
            >
              <Star
                strokeWidth={ICON_STROKE_WIDTH}
                className={cn('h-7 w-7', on ? 'fill-warning text-warning' : 'text-ink-25')}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
      {stars ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="u-micro-strong text-ink">{t('account.agenda.rating.commentLabel')}</span>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={500}
              rows={2}
              disabled={pending}
              placeholder={t('account.agenda.rating.commentPlaceholder')}
              className="rounded-xl bg-surface px-3 py-2 text-sm text-ink shadow-[inset_0_0_0_1.5px_var(--ink-25)] outline-none focus:shadow-[inset_0_0_0_2px_var(--blue)]"
            />
          </label>
          <p className="text-xs text-ink-45">{t('account.agenda.rating.commentNote')}</p>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="u-press inline-flex min-h-11 items-center justify-center rounded-xl bg-blue px-4 text-sm font-bold text-white disabled:opacity-60"
          >
            {t('account.agenda.rating.submit')}
          </button>
        </>
      ) : null}
    </div>
  );
}
