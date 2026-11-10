'use client';

import { useState, useTransition } from 'react';
import { Check } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { useToast } from '@/components/Toast';
import { cn } from '@/lib/utils';
import { CUSTOMER_CATEGORIES } from '@/lib/pushRules';

/**
 * Mon profil › Notifications: one switch per kind of app alert
 * (notification_preferences). Off means the app does not push it — the
 * customer still gets WhatsApp as before unless the WhatsApp switch above is
 * off too. Visits are shown on and locked: a confirmed or cancelled visit is
 * not something to miss. `available` false (before the migration) shows the
 * switches disabled with a note.
 */
export default function NotificationCategorySwitches({ initialPrefs = {}, available = true, setAction }) {
  const t = useT();
  const { showToast } = useToast();
  const [prefs, setPrefs] = useState(initialPrefs);
  const [pending, startTransition] = useTransition();

  function toggle(key) {
    const next = prefs[key] === false;
    setPrefs((p) => ({ ...p, [key]: next }));
    startTransition(async () => {
      let result;
      try {
        result = await setAction(key, next);
      } catch {
        result = { ok: false };
      }
      if (!result?.ok) {
        setPrefs((p) => ({ ...p, [key]: !next }));
        showToast({ type: 'error', message: t('account.profile.saveFailed') });
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="mb-1 text-[0.8125rem] leading-[1.5] text-ink-45">
        {available ? t('account.notifications.switchesHint') : t('account.notifications.switchesUnavailable')}
      </p>
      {CUSTOMER_CATEGORIES.map((category) => {
        const on = category.locked || prefs[category.key] !== false;
        const disabled = category.locked || !available || pending;
        return (
          <div key={category.key} className="flex min-h-11 items-center justify-between gap-4">
            <span className="text-[0.875rem] font-semibold text-ink">{t(category.labelKey)}</span>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={t(category.labelKey)}
              disabled={disabled}
              onClick={() => toggle(category.key)}
              className={cn(
                'u-hit relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60',
                on ? 'bg-blue' : 'bg-ink-25',
              )}
            >
              {/* Same switch as Mon profil's WhatsApp alerts one (ProfileSettings.js). */}
              <span
                className={cn(
                  'inline-flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm transition-transform',
                  on ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
                )}
              >
                {on ? <Check strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 text-blue" aria-hidden="true" /> : null}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
