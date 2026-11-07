'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { PartyPopper, Pause, Play } from 'lucide-react';
import { useT } from '@/lib/i18n/client';

function Submit({ className, children, pendingLabel }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}

const PRIMARY = 'u-press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-green-deep px-4 text-[0.9375rem] font-bold text-white hover:opacity-90 disabled:opacity-60';
const SECONDARY = 'u-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-4 text-sm font-bold text-ink hover:border-blue disabled:opacity-60';

/**
 * The customer's own say on where the move stands. "C'est le bon !" is asked
 * twice in place (it stops the alert and closes the request), "Mettre en
 * pause" and "Reprendre" are one tap. Each `*Action` is bound to the project
 * id by the page.
 */
export default function ProjectStatusActions({ status, foundAction, pauseAction, resumeAction, askFound = false }) {
  const t = useT();
  // `askFound`: opened from the "Trouvé" stage pill — the confirmation shows at once.
  const [asking, setAsking] = useState(askFound);
  const pending = t('account.move.status.saving');

  if (status === 'found' || status === 'paused') {
    return (
      <form action={resumeAction}>
        <Submit className={SECONDARY} pendingLabel={pending}>
          <Play strokeWidth={2} className="h-4 w-4" aria-hidden="true" />
          {status === 'found' ? t('account.move.status.notTheOne') : t('account.move.status.resume')}
        </Submit>
      </form>
    );
  }

  if (asking) {
    return (
      <form action={foundAction} className="flex flex-col gap-2 rounded-xl bg-green-tint p-3" role="alertdialog" aria-label={t('account.move.status.foundConfirm')}>
        <p className="text-[0.9375rem] font-semibold text-green-deep">{t('account.move.status.foundConfirm')}</p>
        <p className="text-[0.8125rem] text-ink-70">{t('account.move.status.foundEffect')}</p>
        <div className="flex gap-2">
          <Submit className={PRIMARY} pendingLabel={pending}>{t('account.move.status.foundYes')}</Submit>
          <button type="button" onClick={() => setAsking(false)} className="min-h-11 px-3 text-sm font-semibold text-ink-70 hover:text-ink">
            {t('account.move.delete.no')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => setAsking(true)} className={PRIMARY}>
        <PartyPopper strokeWidth={2} className="h-5 w-5" aria-hidden="true" />
        {t('account.move.status.found')}
      </button>
      <form action={pauseAction}>
        <Submit className={`${SECONDARY} w-full`} pendingLabel={pending}>
          <Pause strokeWidth={2} className="h-4 w-4" aria-hidden="true" />
          {t('account.move.status.pause')}
        </Submit>
      </form>
    </div>
  );
}
