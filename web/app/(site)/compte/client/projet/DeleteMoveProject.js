'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Trash2 } from 'lucide-react';
import { useT } from '@/lib/i18n/client';

function ConfirmButton({ label, pendingLabel }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="u-press inline-flex min-h-11 items-center rounded-md bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * "Supprimer ce projet", asked twice in place (no dialog to load on a slow
 * phone). `action` is deleteMoveProjectAction bound to the project id. The
 * project's alert is not deleted with it — the confirmation says so.
 */
export default function DeleteMoveProject({ action }) {
  const t = useT();
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="u-press inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold text-ink-45 hover:text-red-600"
      >
        <Trash2 strokeWidth={2} className="h-4 w-4" aria-hidden="true" />
        {t('account.move.delete.cta')}
      </button>
    );
  }
  return (
    <form action={action} className="flex w-full flex-col gap-2 rounded-xl bg-red-50 p-3 sm:w-auto" role="alertdialog" aria-label={t('account.move.delete.confirm')}>
      <p className="text-sm font-semibold text-red-800">{t('account.move.delete.confirm')}</p>
      <p className="text-xs text-red-800/80">{t('account.move.delete.alertKept')}</p>
      <div className="flex gap-2">
        <ConfirmButton label={t('account.move.delete.yes')} pendingLabel={t('account.move.delete.deleting')} />
        <button type="button" onClick={() => setAsking(false)} className="min-h-11 px-3 text-sm font-semibold text-ink-70 hover:text-ink">
          {t('account.move.delete.no')}
        </button>
      </div>
    </form>
  );
}
