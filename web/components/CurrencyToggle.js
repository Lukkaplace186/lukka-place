'use client';

import { useSyncExternalStore } from 'react';
import { getCurrency, setCurrency, subscribeCurrency } from '@/lib/currencyPreference';

/**
 * Site-wide USD/FC segmented control — flips the shared display preference
 * every <Price> reads (see lib/currencyPreference.js). Purely a display
 * toggle; it never touches stored data, and every WhatsApp message still
 * quotes the real USD figure (lib/whatsapp.js).
 *
 * This is a headline feature for the diaspora audience, not a utility
 * control, so it is styled explicitly here rather than through the shadcn
 * Button — it needs an `inverted` variant to sit on the transparent header
 * over the hero photograph, which Button's variants don't cover.
 *
 * Buttons are a fixed h-9 (36px) rather than padding-driven — measured on a
 * real phone viewport, the previous padding-only sizing came out to
 * 24x32px, well under the ~40-44px touch target this control needs given
 * how often the diaspora audience taps it.
 */
const OPTIONS = [
  { value: 'USD', label: '$' },
  { value: 'CDF', label: 'FC' },
];

export default function CurrencyToggle({ inverted = false }) {
  const currency = useSyncExternalStore(subscribeCurrency, getCurrency, () => 'USD');

  return (
    <div
      role="group"
      aria-label="Devise d'affichage"
      className={`flex items-center rounded-full border p-0.5 transition-colors ${
        inverted ? 'border-white/30 bg-white/10 backdrop-blur-sm' : 'border-line bg-surface'
      }`}
    >
      {OPTIONS.map(({ value, label }) => {
        const active = currency === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setCurrency(value)}
            aria-pressed={active}
            className={`inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 text-[0.8125rem] font-semibold transition-colors ${
              active
                ? 'bg-blue text-white'
                : inverted
                  ? 'text-white/75 hover:text-white'
                  : 'text-ink-45 hover:text-ink'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
