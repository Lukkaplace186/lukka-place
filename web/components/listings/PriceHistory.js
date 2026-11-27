import { History, TrendingDown, TrendingUp } from 'lucide-react';
import { getLocale, getT } from '@/lib/i18n/server';
import { getPriceHistory } from '@/lib/priceHistory';
import { formatPrice } from '@/lib/format';
import { formatAddedOn } from '@/lib/listingView';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * "Historique du prix" (2026-11-27): the price when the listing went public,
 * then each recorded change, newest last — Zillow's price history, from
 * property_price_history only (lib/priceHistoryRules.js). Streams in under a
 * Suspense on the listing page; renders nothing when the price never changed
 * after publication.
 */
export default async function PriceHistory({ listingId, className = '' }) {
  const history = await getPriceHistory(listingId);
  if (!history) return null;
  const t = await getT();
  const locale = await getLocale();

  const rows = [
    { key: 'start', label: t('listings.detail.priceHistory.listed'), price: history.start, Icon: History, tone: 'text-ink-45' },
    ...history.steps.map((step, i) => ({
      key: `step-${i}`,
      label: t(step.direction === 'down' ? 'listings.detail.priceHistory.down' : 'listings.detail.priceHistory.up', { percent: Math.abs(step.percent) }),
      price: step,
      Icon: step.direction === 'down' ? TrendingDown : TrendingUp,
      tone: step.direction === 'down' ? 'text-green-ink' : 'text-ink-70',
    })),
  ];

  return (
    <section className={className} aria-labelledby="price-history-title">
      <h2 id="price-history-title" className="u-h2 text-ink">{t('listings.detail.priceHistory.title')}</h2>
      <ol className="mt-3 flex flex-col">
        {rows.map(({ key, label, price, Icon, tone }) => (
          <li key={key} className="flex items-center gap-3 border-b border-line py-3 last:border-0">
            <Icon strokeWidth={ICON_STROKE_WIDTH} className={`h-5 w-5 flex-none ${tone}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${tone === 'text-green-ink' ? 'text-green-ink' : 'text-ink'}`}>{label}</p>
              <p className="u-meta">{formatAddedOn(price.at, locale)}</p>
            </div>
            <span className="u-tabular text-[0.9375rem] font-semibold text-ink">
              {formatPrice(price.price, price.purpose, price.price_period)}
            </span>
          </li>
        ))}
      </ol>
      <p className="u-meta mt-2">{t('listings.detail.priceHistory.note')}</p>
    </section>
  );
}
