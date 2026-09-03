'use client';

import Price from './Price';
import { useCdfRate } from '@/lib/CurrencyRateContext';

/**
 * The royal "Prix affiché" panel from the design's listing-detail screen —
 * a `--surface-royal` (royal-700) card sitting under the agent panel in the
 * right rail, restating the price with the exchange rate and the deposit
 * terms beneath it.
 *
 * The design's own copy for the two footnote lines is "1 USD = 2 815 FC ·
 * taux indicatif" and "Garantie 3 mois · charges non comprises". Both are
 * rendered from real values here rather than the mockup's literals: the
 * rate and its date come from the admin-editable `exchange_rates` row via
 * CurrencyRateContext (lib/currencyRate.js), and the deposit line only
 * appears when this listing genuinely has a `deposit_months` value. The
 * design's trailing "charges non comprises" is dropped — nothing in the
 * schema records whether charges are included, and asserting it would be a
 * fabricated term on a page about money.
 */
export default function PricePanel({ listing }) {
  const { cdfPerUsd, updatedAt } = useCdfRate();
  const { price, purpose, price_period: pricePeriod, deposit_months: depositMonths } = listing;

  return (
    <div className="u-lift flex flex-col gap-3 rounded-card bg-blue-deep p-6">
      <span className="u-eyebrow text-white/70">Prix affiché</span>

      <div className="flex flex-col gap-1.5">
        <span className="u-tabular text-[1.875rem] font-bold tracking-[-0.02em] text-white">
          <Price
            amount={price}
            purpose={purpose}
            pricePeriod={pricePeriod}
            showSubtext
            subtextClassName="mt-1 block text-[0.875rem] font-normal tracking-normal text-white/75"
          />
        </span>
      </div>

      <div className="h-px bg-white/20" />

      <div className="flex flex-col gap-1 text-[0.8125rem] text-white/75">
        <span className="u-tabular">
          1 USD = {Number(cdfPerUsd).toLocaleString('fr-FR')} FC · taux indicatif du {updatedAt}
        </span>
        {depositMonths != null ? <span>Garantie {depositMonths} mois</span> : null}
      </div>
    </div>
  );
}
