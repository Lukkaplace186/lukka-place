'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { ALERT_FREQUENCIES, ALERT_FREQUENCY_LABEL_KEYS, MAX_ALERT_LABEL_LENGTH } from '@/lib/alertPreferences';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { updateAlertPreferencesAction } from '../actions';

/**
 * Per-alert WhatsApp frequency and name, on each Alertes card.
 *
 * The frequency applies on change — there is nothing else to confirm, and a
 * separate Save button beside a single select is a step nobody needs. A
 * failed save puts the select back and says why.
 */
export default function AlertPreferences({ savedSearchId, label, frequency, lastAlertedLabel }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(frequency);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(label);

  function save(patch, onFail) {
    startTransition(async () => {
      let result;
      try {
        result = await updateAlertPreferencesAction(savedSearchId, patch);
      } catch {
        result = { ok: false, error: t('account.alerts.prefsFailed') };
      }
      if (!result?.ok) {
        onFail?.();
        showToast({ type: 'error', message: result?.error || t('account.alerts.prefsFailed') });
        return;
      }
      showToast({ message: result.message });
      setRenaming(false);
      router.refresh();
    });
  }

  function changeFrequency(event) {
    const previous = value;
    const next = event.target.value;
    setValue(next);
    save({ frequency: next }, () => setValue(previous));
  }

  function submitRename(event) {
    event.preventDefault();
    const clean = draft.trim();
    if (!clean || clean === label) {
      setRenaming(false);
      return;
    }
    save({ label: clean });
  }

  const selectId = `alert-frequency-${savedSearchId}`;

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label htmlFor={selectId} className="text-[0.8125rem] font-semibold text-ink-70">
          {t('account.alerts.frequencyLabel')}
        </label>
        <select
          id={selectId}
          value={value}
          onChange={changeFrequency}
          disabled={pending}
          className="u-focus-ring h-9 rounded-full border border-line bg-surface px-3 text-[0.8125rem] text-ink disabled:opacity-60"
        >
          {ALERT_FREQUENCIES.map((option) => (
            <option key={option} value={option}>
              {t(ALERT_FREQUENCY_LABEL_KEYS[option])}
            </option>
          ))}
        </select>
        {!renaming ? (
          <button
            type="button"
            onClick={() => {
              setDraft(label);
              setRenaming(true);
            }}
            className="u-press inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[0.8125rem] font-semibold text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink"
          >
            <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
            {t('account.alerts.rename')}
          </button>
        ) : null}
        {lastAlertedLabel ? (
          <span className="text-[0.75rem] text-ink-35">{t('account.alerts.lastAlerted', { date: lastAlertedLabel })}</span>
        ) : null}
      </div>

      {renaming ? (
        <form onSubmit={submitRename} className="flex flex-wrap items-center gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={MAX_ALERT_LABEL_LENGTH}
            aria-label={t('account.alerts.renamePlaceholder')}
            placeholder={t('account.alerts.renamePlaceholder')}
            autoFocus
            className="u-focus-ring h-9 min-w-0 flex-1 basis-56 rounded-md border border-line bg-white px-3 text-[0.875rem] text-ink"
          />
          <button
            type="submit"
            disabled={pending}
            className="u-btn-primary u-press h-9 rounded-full bg-blue px-4 text-[0.8125rem] font-semibold text-white disabled:opacity-60"
          >
            {t('common.actions.save')}
          </button>
          <button
            type="button"
            onClick={() => setRenaming(false)}
            className="u-press h-9 rounded-full px-3 text-[0.8125rem] font-semibold text-ink-45 hover:bg-canvas-alt hover:text-ink"
          >
            {t('common.actions.cancel')}
          </button>
        </form>
      ) : null}
    </div>
  );
}
