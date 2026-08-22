'use client';

import { useSyncExternalStore } from 'react';
import { getCurrency, subscribeCurrency } from '@/lib/currencyPreference';
import { convertToCdf, EXCHANGE_RATE_UPDATED_AT } from '@/lib/currency';
import { formatPrice } from '@/lib/format';

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
 */
export default function Price({ amount, purpose, pricePeriod, className }) {
  const currency = useSyncExternalStore(subscribeCurrency, getCurrency, () => 'USD');

  if (currency === 'CDF') {
    const cdf = convertToCdf(amount);
    const formatted = cdf != null ? cdf.toLocaleString('fr-FR') : '—';
    const suffix = purpose === 'rent' ? (pricePeriod === 'an' ? ' FC / an' : ' FC / mois') : ' FC';
    return (
      <span className={className} title={`Estimation convertie au ${EXCHANGE_RATE_UPDATED_AT} — le prix réel est en USD`}>
        ≈ {formatted}
        {suffix}
      </span>
    );
  }

  return <span className={className}>{formatPrice(amount, purpose, pricePeriod)}</span>;
}
