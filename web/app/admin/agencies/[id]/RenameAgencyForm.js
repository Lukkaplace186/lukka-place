'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n/client';
import { renameAgencyAction } from './renameActions';

/** "Renommer l'agence" — inline, under the agency's heading. */
export default function RenameAgencyForm({ vendorId, name }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="u-micro-strong mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-ink hover:border-blue"
      >
        <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
        {t('admin.agencies.rename')}
      </button>
    );
  }

  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          let result;
          try {
            result = await renameAgencyAction(vendorId, formData);
          } catch (err) {
            result = { ok: false, error: err.message };
          }
          showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error || t('errors.actionFailed') });
          if (result?.ok) {
            setOpen(false);
            router.refresh();
          }
        });
      }}
    >
      <input
        name="agency_name"
        defaultValue={name && !/^Agence #\d+$/.test(name) ? name : ''}
        required
        minLength={2}
        maxLength={160}
        autoFocus
        className="u-focus-ring h-9 w-72 max-w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
      />
      <button type="submit" disabled={pending} className="u-btn-primary u-press inline-flex h-9 items-center rounded-lg px-3 text-sm font-bold disabled:opacity-50">
        {t('admin.agencies.renameSave')}
      </button>
      <button type="button" disabled={pending} onClick={() => setOpen(false)} className="u-micro-strong h-9 rounded-lg px-3 text-ink-70 hover:text-ink">
        {t('common.actions.cancel')}
      </button>
    </form>
  );
}
