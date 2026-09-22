'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { Check } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/client';

/**
 * The name field, saved in place. The button only exists once the name has
 * actually changed — a permanent "Enregistrer les modifications" under one
 * field reads as a form with something still to do. Saving keeps the typed
 * value and says so at once; a failed save keeps it too, so nothing typed is
 * lost, and says it did not save.
 */
export function ProfileNameForm({ initialName, saveAction }) {
  const t = useT();
  const { showToast } = useToast();
  const [saved, setSaved] = useState(initialName || '');
  const [draft, setDraft] = useState(initialName || '');
  const [pending, startTransition] = useTransition();
  const dirty = draft.trim() !== saved.trim();

  function submit(event) {
    event.preventDefault();
    if (!dirty || pending) return;
    const next = draft.trim();
    startTransition(async () => {
      let result;
      try {
        result = await saveAction(next);
      } catch {
        result = { ok: false };
      }
      if (!result?.ok) {
        showToast({ type: 'error', message: t('account.profile.saveFailed') });
        return;
      }
      setSaved(next);
      setDraft(next);
      showToast({ message: t('account.profile.saved') });
    });
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="fullName" className="u-eyebrow mb-1.5 block">
        {t('account.profile.fullName')}
      </label>
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('account.profile.namePlaceholder')}
          className="u-focus-ring h-11 w-full rounded-md border border-line bg-white px-3.5 text-[0.9375rem] text-ink placeholder:text-ink-25 sm:max-w-sm"
        />
        {dirty || pending ? (
          <button
            type="submit"
            disabled={pending}
            className="u-btn-primary u-press inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-blue px-6 text-[0.875rem] font-semibold text-white disabled:opacity-60"
          >
            {pending ? t('common.actions.saving') : t('common.actions.save')}
          </button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * The account-wide WhatsApp alerts switch. It flips on tap (optimistic) and
 * flips back, with a toast, if the save fails.
 */
export function WhatsAppAlertsSwitch({ initialEnabled, phoneLabel, setAction }) {
  const t = useT();
  const { showToast } = useToast();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [optimistic, setOptimistic] = useOptimistic(enabled);
  const [, startTransition] = useTransition();

  function toggle() {
    const next = !optimistic;
    startTransition(async () => {
      setOptimistic(next);
      let result;
      try {
        result = await setAction(next);
      } catch {
        result = { ok: false };
      }
      if (!result?.ok) {
        showToast({ type: 'error', message: t('account.profile.saveFailed') });
        return;
      }
      setEnabled(next);
    });
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="u-title-card text-ink">{t('account.alerts.whatsappSettingsTitle')}</h3>
        <p className="mt-1.5 max-w-lg text-[0.8125rem] leading-[1.5] text-ink-45">
          {optimistic ? t('account.alerts.whatsappOn', { phone: phoneLabel }) : t('account.alerts.whatsappOff')}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={optimistic}
        aria-label={t('account.alerts.whatsappSettingsTitle')}
        onClick={toggle}
        className={cn(
          'u-hit relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors',
          optimistic ? 'bg-blue' : 'bg-ink-25',
        )}
      >
        <span
          className={cn(
            'inline-flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm transition-transform',
            optimistic ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
          )}
        >
          {optimistic ? (
            <Check strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 text-blue" aria-hidden="true" />
          ) : null}
        </span>
      </button>
    </div>
  );
}
