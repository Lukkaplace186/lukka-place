'use client';

import { useSyncExternalStore } from 'react';
import { getCurrency, subscribeCurrency } from '@/lib/currencyPreference';
import { convertToCdf, EXCHANGE_RATE_UPDATED_AT } from '@/lib/currency';
import { formatPrice } from '@/lib/format';

const CONVERSION_TOOLTIP = `Estimation convertie au ${EXCHANGE_RATE_UPDATED_AT} — le prix réel est en USD`;

/**
 * Drop-in replacement for a raw formatPrice(...) text node. Renders the
 * real stored USD price, or — if the visitor has toggled to CDF via
 * CurrencyToggle.js — a converted estimate, always visibly marked "≈" and
 * with a title tooltip naming the conversion date, never presented as the
 * listing's actual stored currency (there isn't one on the live schema —
 * see lib/currency.js's doc comment).
 *
 * Server snapshot is always 'USD' (same useSyncExternalStore pattern as
 * FavoriteButton.js — localStorage doesn't exist server-side), so this
 * never causes a hydration mismatch even before the real client-side
 * preference loads.
 *
 * `showSubtext` (opt-in, default off — every existing call site is
 * unaffected) adds a second, smaller line with whichever currency ISN'T
 * the CurrencyToggle-selected primary. The toggle still controls which
 * figure leads; this only stops the other one from disappearing entirely,
 * for surfaces (card price displays) where seeing both matters. Still the
 * same real conversion (lib/currency.js), same "≈"/tooltip honesty marker
 * — never presented as a second stored currency.
 */
export default function Price({
  amount,
  purpose,
  pricePeriod,
  className,
  showSubtext = false,
  // mt-1/leading-normal regardless of the parent's own leading (card price
  // wrappers use leading-none for the primary figure, which would otherwise
  // crush this line against it too, since it inherits from the same block).
  subtextClassName = 'mt-1 block text-[0.75rem] font-normal leading-normal text-ink-45',
}) {
  const currency = useSyncExternalStore(subscribeCurrency, getCurrency, () => 'USD');

  const cdf = convertToCdf(amount);
  const cdfFormatted = cdf != null ? cdf.toLocaleString('fr-FR') : null;
  const cdfSuffix = purpose === 'rent' ? (pricePeriod === 'an' ? ' FC / an' : ' FC / mois') : ' FC';
  const usdFormatted = formatPrice(amount, purpose, pricePeriod);

  if (currency === 'CDF') {
    const primary = (
      <span className={className} title={CONVERSION_TOOLTIP}>
        ≈ {cdfFormatted ?? '—'}
        {cdfSuffix}
      </span>
    );
    return showSubtext ? (
      <span>
        {primary}
        <span className={subtextClassName}>{usdFormatted}</span>
      </span>
    ) : (
      primary
    );
  }

  const primary = <span className={className}>{usdFormatted}</span>;
  return showSubtext && cdfFormatted != null ? (
    <span>
      {primary}
      <span className={subtextClassName} title={CONVERSION_TOOLTIP}>
        ≈ {cdfFormatted}
        {cdfSuffix}
      </span>
    </span>
  ) : (
    primary
  );
}
