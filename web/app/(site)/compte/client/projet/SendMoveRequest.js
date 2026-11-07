'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Send } from 'lucide-react';
import { useT } from '@/lib/i18n/client';

const ERROR_KEYS = {
  transaction: 'account.move.page.request.missing.transaction',
  communes: 'account.move.page.request.missing.communes',
  recent: 'account.move.page.request.errors.recent',
  send: 'account.move.page.request.errors.send',
};

/**
 * The one button that contacts agencies — never pressed for the customer.
 * `action` is sendMoveRequestAction bound to this project's id by the page.
 */
export default function SendMoveRequest({ action }) {
  const t = useT();
  const [state, formAction, pending] = useActionState(action, null);

  if (state?.status === 'sent') {
    return (
      <div className="flex flex-col gap-2" role="status">
        <p className="rounded-xl bg-green-tint px-4 py-3 text-[0.9375rem] font-semibold text-green-deep">{t('account.move.page.request.sentNow')}</p>
        <Link href="/compte/client/messages" className="inline-flex min-h-11 items-center text-sm font-bold text-blue hover:underline">
          {t('account.move.page.request.seeMessages')}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <button
        type="submit"
        disabled={pending}
        className="u-btn-primary inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-blue px-4 text-[0.9375rem] font-bold text-white hover:bg-blue-deep disabled:opacity-60"
      >
        <Send strokeWidth={2} className="h-4 w-4" aria-hidden="true" />
        {pending ? t('account.move.page.request.sending') : t('account.move.page.request.cta')}
      </button>
      {state?.status === 'error' ? (
        <p className="text-sm text-red-600" role="alert">{t(ERROR_KEYS[state.code] || ERROR_KEYS.send)}</p>
      ) : null}
      <p className="text-xs text-ink-45">{t('account.move.page.request.privacy')}</p>
    </form>
  );
}
