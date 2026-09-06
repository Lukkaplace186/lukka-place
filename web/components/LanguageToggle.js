'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { LOCALES, LOCALE_LABELS } from '@/lib/i18n/config';
import { persistLocale, useLocale, useT } from '@/lib/i18n/client';

/**
 * Site-wide FR | EN segmented control.
 *
 * Deliberately the same shape as CurrencyToggle — a segmented pill, not a
 * dropdown — because it sits beside it in the header and the two are the
 * same kind of control: a display preference with exactly two real options.
 * A <select> for two items would read as a heavier, different affordance in
 * the same cluster.
 *
 * The interesting part is what happens on click. Locale lives in a cookie
 * that Server Components read (lib/i18n/server.js), so flipping it in the
 * browser is only half the job: without `router.refresh()` the client
 * subtree would re-render in the new language while every server-rendered
 * heading, table and status pill on the page stayed in the old one. The
 * refresh re-requests the current route's RSC payload, which is now rendered
 * against the new cookie, and React reconciles it in place — no full reload,
 * no scroll jump, no lost form state.
 *
 * `useTransition` keeps that refresh non-blocking and gives us a real pending
 * flag, so the control can show it is working on a slow connection rather
 * than appearing inert for a beat.
 */
export default function LanguageToggle({ longLabels = false, tone = 'light', className = '' }) {
  const locale = useLocale();
  const router = useRouter();
  const t = useT();
  const [pending, startTransition] = useTransition();

  const royal = tone === 'royal';

  function select(next) {
    if (next === locale) return;
    persistLocale(next);
    // Re-render the Server Components of the current route against the new
    // cookie. See the doc comment above for why this is not optional.
    startTransition(() => router.refresh());
  }

  return (
    <div
      role="group"
      aria-label={t('common.language.switcherLabel')}
      data-pending={pending ? '' : undefined}
      className={`flex items-center rounded-full border p-0.5 shadow-sm transition-opacity ${
        royal ? 'border-white/25 bg-white/10' : 'border-blue-deep bg-blue-deep'
      } ${pending ? 'opacity-70' : ''} ${className}`}
    >
      {LOCALES.map((value) => {
        const active = locale === value;
        return (
          <button
            key={value}
            type="button"
            lang={value}
            onClick={() => select(value)}
            aria-pressed={active}
            // The visible label is "FR"/"EN", which a screen reader would
            // spell out letter by letter; the full language name in its own
            // language is the accessible name instead.
            aria-label={LOCALE_LABELS[value].long}
            className={`inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 text-[0.8125rem] font-semibold transition-colors ${
              active
                ? 'bg-white text-blue-deep shadow-sm'
                : royal
                  ? 'text-white/70 hover:text-white'
                  : 'text-white/75 hover:text-white'
            }`}
          >
            {longLabels ? LOCALE_LABELS[value].long : LOCALE_LABELS[value].short}
          </button>
        );
      })}
    </div>
  );
}
