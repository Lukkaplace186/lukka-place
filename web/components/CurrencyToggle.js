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
 * Button, whose variants don't cover a segmented control. (It used to carry
 * an `inverted` variant for the header's transparent-over-hero state; the
 * header is solid on every route now — see Header.js — and nothing passed
 * it any more.)
 *
 * Solid `bg-blue-deep` container (the real dark-navy brand token, not a
 * generic slate) with a bright white pill for the active segment — a
 * deliberate high-contrast pass, per an explicit "bold like Zoopla/Zillow"
 * instruction, over the previous light `bg-surface` container with only
 * the active segment filled. The one real control in the top-right utility
 * cluster that's meant to visually anchor the bar, not blend into it.
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

// The header's control is a tight icon-sized pair, so USD is a bare "$"
// there. web/Design's agent-portfolio screen labels the same control
// "USD / FC" in a wider row where the word fits — `longLabels` switches to
// that without forking the component or the shared preference behind it.
const LONG_OPTIONS = [
  { value: 'USD', label: 'USD' },
  { value: 'CDF', label: 'FC' },
];

// `tone="quiet"`: a light segmented control (canvas track, white active
// chip) for places where the toggle is a setting among links, like the mobile
// drawer. The default navy pill is right in the desktop header and footer,
// where it is meant to be seen; in the drawer it outweighed the navigation.
export default function CurrencyToggle({ longLabels = false, tone = 'royal' }) {
  const quiet = tone === 'quiet';
  const currency = useSyncExternalStore(subscribeCurrency, getCurrency, () => 'USD');

  return (
    <div
      role="group"
      aria-label="Devise d'affichage"
      className={`flex items-center rounded-full border p-0.5 transition-colors ${quiet ? 'border-line bg-canvas-alt' : 'border-blue-deep bg-blue-deep shadow-sm'}`}
    >
      {(longLabels ? LONG_OPTIONS : OPTIONS).map(({ value, label }) => {
        const active = currency === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setCurrency(value)}
            aria-pressed={active}
            className={`inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 text-[0.8125rem] font-semibold transition-colors ${
              active ? `bg-white shadow-sm ${quiet ? 'text-ink' : 'text-blue-deep'}` : quiet ? 'text-ink-45 hover:text-ink' : 'text-white/75 hover:text-white'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
