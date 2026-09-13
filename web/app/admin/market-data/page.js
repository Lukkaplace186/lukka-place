import Link from 'next/link';
import { getAgentPerformance, listViewingFeed } from '@/lib/adminApi';
import { getClosedTransactions } from '@/lib/adminLeadRouting';
import { DECLINE_REASON_CODES, DECLINE_REASON_LABEL_KEYS, PRICE_SOURCE_LABEL_KEYS } from '@/lib/adminLabels';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, Panel, Stat, TD, TD_RIGHT, TH, TH_RIGHT, formatPct, money } from '../LeadRoutingUI';
import PricingBenchmarks from './PricingBenchmarks';

export const metadata = {
  title: 'Données marché — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const SOURCE_TONE = { WHATSAPP_AGENT_REPLY: 'success', DIRECT_INPUT: 'blue', ADMIN_DASHBOARD: 'warning' };

/**
 * Market intelligence: what listings asked, what they actually closed at, and
 * why viewings fall through.
 *
 * Admin-only and noindex for the same reason the pricing medians always were:
 * achieved prices are the product, and a public page gives them away. Every
 * figure is read from recorded closes — nothing is estimated, and a commune
 * below the sample threshold shows its count, not an average.
 */
export default async function AdminMarketDataPage() {
  const t = await getT();

  const [closed, performance, feed] = await Promise.all([
    getClosedTransactions({ limit: 200 }),
    getAgentPerformance({ days: 365 }).catch((err) => ({ error: err.message })),
    listViewingFeed({ limit: 1 }).catch((err) => ({ error: err.message })),
  ]);

  const fromWhatsapp = closed.filter((row) => row.priceSource === 'WHATSAPP_AGENT_REPLY').length;
  const fromAgentDashboard = closed.filter((row) => row.priceSource === 'DIRECT_INPUT').length;
  const noSource = closed.filter((row) => !row.priceSource).length;

  const communes = performance?.communes || [];
  const minSample = performance?.minSample ?? 5;

  // Fall-through reasons, one bar per code, agent and customer counted apart.
  const reasons = DECLINE_REASON_CODES.map((code) => {
    const matching = (feed?.summary?.byDeclineReason || []).filter((row) => row.code === code);
    const agent = matching.filter((row) => row.by === 'AGENT').reduce((sum, row) => sum + row.n, 0);
    const customer = matching.filter((row) => row.by === 'CUSTOMER').reduce((sum, row) => sum + row.n, 0);
    return { code, agent, customer, total: agent + customer };
  });
  const reasonMax = Math.max(0, ...reasons.map((reason) => reason.total));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.marketData.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.marketData.subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('admin.marketData.closedCount')} value={closed.length} />
        <Stat label={t('admin.marketData.fromWhatsapp')} value={fromWhatsapp} />
        <Stat label={t('admin.marketData.fromAgentDashboard')} value={fromAgentDashboard} />
        <Stat label={t('admin.marketData.noSource')} value={noSource} hint={t('admin.marketData.noSourceHint')} />
      </div>

      {performance?.error ? <ErrorNote>{t('admin.marketData.engineError', { error: performance.error })}</ErrorNote> : null}

      <Panel
        title={t('admin.marketData.communeTitle')}
        note={t('admin.marketData.communeNote', { min: minSample })}
        isEmpty={communes.length === 0}
        emptyText={t('admin.marketData.communeEmpty')}
      >
        <table className="w-full min-w-[40rem] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={TH}>{t('admin.marketData.colCommune')}</th>
              <th className={TH_RIGHT}>{t('admin.marketData.colSample')}</th>
              <th className={TH_RIGHT}>{t('admin.marketData.colAvgDelta')}</th>
              <th className={TH_RIGHT}>{t('admin.marketData.colAvgDeltaUsd')}</th>
              <th className={TH_RIGHT}>{t('admin.marketData.colFromWhatsapp')}</th>
            </tr>
          </thead>
          <tbody>
            {communes.map((row) => (
              <tr key={row.commune || 'untagged'} className="border-b border-line last:border-0">
                <td className={`${TD} font-semibold text-ink`}>{row.commune || t('admin.marketData.untagged')}</td>
                <td className={TD_RIGHT}>{row.sample}</td>
                {row.suppressed ? (
                  <td className={`${TD} text-center text-ink-45`} colSpan={2}>{t('admin.marketData.notEnough')}</td>
                ) : (
                  <>
                    <td className={TD_RIGHT}>{formatPct(row.avgDeltaPct)}</td>
                    <td className={TD_RIGHT}>{row.avgDeltaUsd == null ? '—' : `${row.avgDeltaUsd > 0 ? '+' : ''}${money(row.avgDeltaUsd)}`}</td>
                  </>
                )}
                <td className={TD_RIGHT}>{row.fromWhatsapp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel
        title={t('admin.marketData.transactionsTitle')}
        isEmpty={closed.length === 0}
        emptyText={t('admin.marketData.transactionsEmpty')}
      >
        <table className="w-full min-w-[60rem] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={TH}>{t('admin.marketData.colListing')}</th>
              <th className={TH}>{t('admin.marketData.colCommune')}</th>
              <th className={TH_RIGHT}>{t('admin.marketData.colList')}</th>
              <th className={TH_RIGHT}>{t('admin.marketData.colSold')}</th>
              <th className={TH_RIGHT}>{t('admin.marketData.colDeltaUsd')}</th>
              <th className={TH_RIGHT}>{t('admin.marketData.colDeltaPct')}</th>
              <th className={TH}>{t('admin.marketData.colSource')}</th>
              <th className={TH}>{t('admin.marketData.colSoldAt')}</th>
            </tr>
          </thead>
          <tbody>
            {closed.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-0">
                <td className={TD}>
                  <Link href={`/admin/listings/${row.id}`} className="font-semibold text-blue-deep hover:underline">
                    {row.reference ? `Réf: ${row.reference}` : `#${row.id}`}
                  </Link>
                  {row.title ? <div className="max-w-[18rem] truncate text-ink-45">{row.title}</div> : null}
                </td>
                <td className={TD}>{row.commune || '—'}</td>
                <td className={TD_RIGHT}>{money(row.listPriceUsd)}</td>
                <td className={TD_RIGHT}>{money(row.soldPriceUsd)}</td>
                <td className={TD_RIGHT}>
                  {row.priceDeltaUsd == null ? '—' : `${row.priceDeltaUsd > 0 ? '+' : ''}${money(row.priceDeltaUsd)}`}
                </td>
                <td className={TD_RIGHT}>{formatPct(row.priceDeltaPct)}</td>
                <td className={TD}>
                  {row.priceSource ? (
                    <Chip tone={SOURCE_TONE[row.priceSource]}>{t(PRICE_SOURCE_LABEL_KEYS[row.priceSource])}</Chip>
                  ) : (
                    <span className="text-ink-35">{t('admin.marketData.noSource')}</span>
                  )}
                </td>
                <td className={`${TD} whitespace-nowrap`}>
                  {row.soldAt ? new Date(row.soldAt).toLocaleDateString('fr-FR', { timeZone: 'UTC' }) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {feed?.error ? <ErrorNote>{t('admin.marketData.engineError', { error: feed.error })}</ErrorNote> : null}

      <Panel
        title={t('admin.marketData.declinesTitle')}
        note={t('admin.marketData.declinesNote')}
        isEmpty={reasonMax === 0}
        emptyText={t('admin.marketData.declinesEmpty')}
      >
        {/* Horizontal bars rather than the pie the brief sketched: five close
            categories compare far better by length than by angle, and every
            bar carries its exact count, so nothing is read off the shape. */}
        <ul className="flex flex-col gap-3 p-4">
          {reasons.map((reason) => (
            <li key={reason.code} className="grid grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)_auto] items-center gap-3">
              <span className="u-micro text-ink">{t(DECLINE_REASON_LABEL_KEYS[reason.code])}</span>
              <span
                className="h-2.5 rounded-r bg-canvas-deep"
                title={`${t(DECLINE_REASON_LABEL_KEYS[reason.code])} : ${reason.total}`}
              >
                <span
                  className="block h-2.5 rounded-r bg-blue"
                  style={{ width: reasonMax ? `${(reason.total / reasonMax) * 100}%` : '0%' }}
                />
              </span>
              <span className="u-micro u-tabular whitespace-nowrap text-ink-70">
                <span className="font-semibold text-ink">{reason.total}</span>
                {' · '}
                {t('admin.marketData.agentCount', { count: reason.agent })}
                {' · '}
                {t('admin.marketData.customerCount', { count: reason.customer })}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <PricingBenchmarks />
    </div>
  );
}
