'use client';

import { useState, useTransition } from 'react';
import { Check, Clock, X } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

const CHOICES = [
  { answer: 'YES', labelKey: 'account.followup.yes', icon: Check },
  { answer: 'NOT_YET', labelKey: 'account.followup.notYet', icon: Clock },
  { answer: 'NO_LONGER', labelKey: 'account.followup.noLonger', icon: X },
];

/**
 * The three answers as large buttons; after one, what happens next. An
 * answer already given (here, on WhatsApp or another device) shows its
 * result straight away.
 */
export default function FollowupAnswers({ leadId, initialAnswer = null, answerAction }) {
  const t = useT();
  const [answer, setAnswer] = useState(initialAnswer);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function choose(value) {
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = await answerAction(leadId, value);
      } catch {
        result = { ok: false, error: 'failed' };
      }
      if (result?.ok) setAnswer(result.answer || value);
      else setError(result?.error === 'not-found' ? t('account.followup.notFound') : t('account.followup.failed'));
    });
  }

  if (answer) {
    const done = {
      YES: t('account.followup.doneYes'),
      NOT_YET: t('account.followup.doneNotYet'),
      NO_LONGER: t('account.followup.doneNoLonger'),
    }[answer];
    return (
      <p role="status" className="rounded-card bg-success-tint px-4 py-3 text-[0.9375rem] font-semibold text-ink">
        {done}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {CHOICES.map(({ answer: value, labelKey, icon: Icon }) => (
        <button
          key={value}
          type="button"
          disabled={pending}
          onClick={() => choose(value)}
          className={cn(
            'u-press flex min-h-14 items-center gap-3 rounded-card border border-line bg-surface px-4 text-left text-[0.9375rem] font-bold text-ink transition-colors hover:bg-canvas-alt disabled:opacity-60',
          )}
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-tint text-blue">
            <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
          </span>
          {t(labelKey)}
        </button>
      ))}
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
