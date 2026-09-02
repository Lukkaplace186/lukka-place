'use client';

import { useSyncExternalStore } from 'react';
import { getCurrency, subscribeCurrency } from '@/lib/currencyPreference';
import { convertToCdf } from '@/lib/currency';
import { useCdfRate } from '@/lib/CurrencyRateContext';
import { formatPrice, formatPriceCdf, formatCdfCompact } from '@/lib/format';

/**
 * Drop-in replacement for a raw formatPrice(...) text node.
 *
 * There are now two genuinely different situations, and the whole point of
 * this component is to not blur them:
 *
 *  1. **Listing authored in USD** (`currency = 'USD'` — the default, and
 *     every listing that existed before the dual-column migration). The USD
 *     figure is real; any FC figure is a conversion, so it is marked "≈",
 *     rendered compact, and carries a tooltip naming the rate date. This is
 *     exactly the previous behaviour, unchanged.
 *
 *  2. **Listing authored in FC** (`currency = 'CDF'`, with the agent's own
 *     figure in `priceOriginal`). Now the FC figure is the real one — shown
 *     in full digits with no "≈", because it is not an estimate — and it is
 *     the *USD* side that is derived and gets the "≈" and the tooltip.
 *
 * `amount` keeps meaning what it always meant: the canonical USD `price`
 * column that every filter, sort and the engine's budget matcher compare
 * against. For a CDF-authored listing that value is the converted-at-save
 * figure, which is why it is presented as an approximation there.
 *
 * `currency`/`priceOriginal` are optional with USD-shaped defaults, so every
 * existing call site that passes neither behaves exactly as before.
 *
 * Server snapshot is always 'USD' (same useSyncExternalStore pattern as
 * FavoriteButton.js — localStorage doesn't exist server-side), so this never
 * causes a hydration mismatch before the real preference loads.
 */
export default function Price({
  amount,
  purpose,
  pricePeriod,
  className,
  currency: listingCurrency = 'USD',
  priceOriginal = null,
  showSubtext = false,
  // mt-1/leading-normal regardless of the parent's own leading (card price
  // wrappers use leading-none for the primary figure, which would otherwise
  // crush this line against it too, since it inherits from the same block).
  subtextClassName = 'mt-1 block text-[0.75rem] font-normal leading-normal text-ink-45',
}) {
  const preference = useSyncExternalStore(subscribeCurrency, getCurrency, () => 'USD');
  const { cdfPerUsd, updatedAt } = useCdfRate();

  // Is the FC figure the agent's own, or one we computed?
  const nativeIsCdf = listingCurrency === 'CDF' && priceOriginal != null;

  const usdText = formatPrice(amount, purpose, pricePeriod);
  const cdfExactText = nativeIsCdf ? formatPriceCdf(priceOriginal, purpose, pricePeriod) : null;

  const cdfEstimate = convertToCdf(amount, cdfPerUsd);
  const cdfEstimateText = cdfEstimate != null ? formatCdfCompact(cdfEstimate) : null;
  const cdfSuffix = purpose === 'rent' ? (pricePeriod === 'an' ? ' FC / an' : ' FC / mois') : ' FC';

  const tooltip = nativeIsCdf
    ? `Prix affiché en USD, converti au taux du ${updatedAt} — le prix réel est en FC`
    : `Estimation convertie au ${updatedAt} — le prix réel est en USD`;

  // Each side resolved once: { text, approximate }. `approximate` is what
  // decides the "≈" and the tooltip, and it is driven by which currency the
  // listing was actually authored in — never by the visitor's preference.
  const usd = { text: usdText, approximate: nativeIsCdf };
  const cdf = nativeIsCdf
    ? { text: cdfExactText, approximate: false }
    : { text: cdfEstimateText != null ? `${cdfEstimateText}${cdfSuffix}` : null, approximate: true };

  const leading = preference === 'CDF' ? cdf : usd;
  const secondary = preference === 'CDF' ? usd : cdf;

  const render = (side, extraClassName) =>
    side.text == null ? null : (
      <span className={extraClassName} title={side.approximate ? tooltip : undefined}>
        {side.approximate ? '≈ ' : ''}
        {side.text}
      </span>
    );

  const primary = render(leading, className) ?? <span className={className}>—</span>;

  return showSubtext && secondary.text != null ? (
    <span>
      {primary}
      {render(secondary, subtextClassName)}
    </span>
  ) : (
    primary
  );
}
