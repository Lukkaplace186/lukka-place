'use client';

import { useSyncExternalStore } from 'react';
import { getCurrency, subscribeCurrency } from '@/lib/currencyPreference';
import { convertToCdf } from '@/lib/currency';
import { useCdfRate } from '@/lib/CurrencyRateContext';
import { formatPriceParts, formatPriceCdfParts, formatCdfCompact } from '@/lib/format';

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
  // The rental period ("/ mois") rendered lighter and smaller than the
  // figure it qualifies, the way Rightmove sets it — the number is what
  // gets scanned, the period is a qualifier on it. Applies only to the
  // PRIMARY side; the converted secondary line is already small enough
  // that splitting its weight again would just make it noisy.
  periodClassName = 'ml-1 text-[0.875rem] font-normal tracking-normal text-ink',
}) {
  const preference = useSyncExternalStore(subscribeCurrency, getCurrency, () => 'USD');
  const { cdfPerUsd, updatedAt } = useCdfRate();

  // Is the FC figure the agent's own, or one we computed?
  const nativeIsCdf = listingCurrency === 'CDF' && priceOriginal != null;

  const usdParts = formatPriceParts(amount, purpose, pricePeriod);
  const cdfExactParts = nativeIsCdf ? formatPriceCdfParts(priceOriginal, purpose, pricePeriod) : null;

  const cdfEstimate = convertToCdf(amount, cdfPerUsd);
  const cdfEstimateText = cdfEstimate != null ? formatCdfCompact(cdfEstimate) : null;
  const cdfPeriod = purpose === 'rent' ? (pricePeriod === 'an' ? '/ an' : '/ mois') : null;

  const tooltip = nativeIsCdf
    ? `Prix affiché en USD, converti au taux du ${updatedAt} — le prix réel est en FC`
    : `Estimation convertie au ${updatedAt} — le prix réel est en USD`;

  // Each side resolved once: { text, approximate }. `approximate` is what
  // decides the "≈" and the tooltip, and it is driven by which currency the
  // listing was actually authored in — never by the visitor's preference.
  const usd = { ...usdParts, approximate: nativeIsCdf };
  const cdf = nativeIsCdf
    ? { ...cdfExactParts, approximate: false }
    : {
        amount: cdfEstimateText != null ? `${cdfEstimateText} FC` : null,
        period: cdfEstimateText != null ? cdfPeriod : null,
        approximate: true,
      };

  const leading = preference === 'CDF' ? cdf : usd;
  const secondary = preference === 'CDF' ? usd : cdf;

  // `splitPeriod` is what separates the two roles: the primary figure gets
  // its period in its own lighter span, the secondary keeps the period
  // joined inline so it still reads as one compact reference figure.
  const render = (side, extraClassName, splitPeriod) =>
    side.amount == null ? null : (
      <span className={extraClassName} title={side.approximate ? tooltip : undefined}>
        {side.approximate ? '≈ ' : ''}
        {side.amount}
        {side.period ? (
          splitPeriod
            ? <span className={periodClassName}>{side.period}</span>
            : ` ${side.period}`
        ) : null}
      </span>
    );

  const primary = render(leading, className, true) ?? <span className={className}>—</span>;

  return showSubtext && secondary.amount != null ? (
    <span>
      {primary}
      {render(secondary, subtextClassName, false)}
    </span>
  ) : (
    primary
  );
}
