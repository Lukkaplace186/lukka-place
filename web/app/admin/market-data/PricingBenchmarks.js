import { TrendingDown, TrendingUp } from 'lucide-react';
import { getMarketBenchmarks, benchmarkTotals, MIN_SAMPLE } from '@/lib/marketBenchmarks';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { Stat, money } from '../LeadRoutingUI';

/**
 * Median asking vs achieved by commune × transaction × type — moved here from
 * /admin/benchmarks, which is now the agent leaderboard. The data, the
 * MIN_SAMPLE suppression and every honesty rule are unchanged; see
 * lib/marketBenchmarks.js.
 */

/**
 * The negotiation gap. Negative means it sold BELOW asking, which is the
 * normal case and should not read as an error.
 */
function Delta({ pct }) {
  if (pct == null) return <span className="text-ink-45">—</span>;
  const rounded = Math.round(pct * 10) / 10;
  const down = rounded < 0;
  const Icon = down ? TrendingDown : TrendingUp;
  return (
    <span className={`inline-flex items-center gap-1 ${down ? 'text-ink' : 'text-green-deep'}`}>
      <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
      {rounded > 0 ? '+' : ''}{rounded.toLocaleString('fr-FR')}%
    </span>
  );
}

export default async function PricingBenchmarks() {
  const t = await getT();
  const rows = await getMarketBenchmarks();
  const totals = benchmarkTotals(rows);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="u-title-section text-ink">{t('admin.benchmarks.title')}</h2>
        <p className="u-micro mt-1 text-ink-45">{t('admin.benchmarks.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t('admin.benchmarks.transactionsClosed')} value={totals.transactions} />
        <Stat
          label={t('admin.benchmarks.reportableCells')}
          value={totals.reportable}
          hint={t('admin.benchmarks.minSampleNote', { min: MIN_SAMPLE })}
        />
        <Stat label={t('admin.benchmarks.communesCovered')} value={totals.communes} />
      </div>

      <h3 className="u-title-card text-ink">{t('admin.benchmarks.tableTitle')}</h3>
      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-surface px-6 py-10 text-center">
          <p className="u-micro text-ink-45">{t('admin.benchmarks.empty')}</p>
        </div>
      ) : (
        <div className="u-card overflow-x-auto rounded-card bg-surface">
          <table className="w-full min-w-[52rem] border-collapse">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="u-eyebrow px-4 py-3 text-ink-45">{t('admin.benchmarks.commune')}</th>
                <th className="u-eyebrow px-4 py-3 text-ink-45">{t('admin.benchmarks.purpose')}</th>
                <th className="u-eyebrow px-4 py-3 text-ink-45">{t('admin.benchmarks.propertyType')}</th>
                <th className="u-eyebrow px-4 py-3 text-right text-ink-45">{t('admin.benchmarks.sample')}</th>
                <th className="u-eyebrow px-4 py-3 text-right text-ink-45">{t('admin.benchmarks.medianAsking')}</th>
                <th className="u-eyebrow px-4 py-3 text-right text-ink-45">{t('admin.benchmarks.medianAchieved')}</th>
                <th className="u-eyebrow px-4 py-3 text-right text-ink-45">{t('admin.benchmarks.medianDelta')}</th>
                <th className="u-eyebrow px-4 py-3 text-right text-ink-45">{t('admin.benchmarks.medianDays')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.commune}|${row.purpose}|${row.propertyType}`} className="border-b border-line last:border-0">
                  <td className="u-micro-strong px-4 py-3 text-ink">{row.commune}</td>
                  <td className="u-micro px-4 py-3 text-ink">{row.purpose}</td>
                  <td className="u-micro px-4 py-3 text-ink">{row.propertyType || '—'}</td>
                  <td className="u-micro u-tabular px-4 py-3 text-right text-ink">{row.sample}</td>
                  {row.suppressed ? (
                    <td className="u-micro px-4 py-3 text-center text-ink-45" colSpan={4}>
                      {t('admin.benchmarks.notEnough')}
                    </td>
                  ) : (
                    <>
                      <td className="u-micro u-tabular px-4 py-3 text-right text-ink">{money(row.medianAsking)}</td>
                      <td className="u-micro u-tabular px-4 py-3 text-right text-ink">{money(row.medianAchieved)}</td>
                      <td className="u-micro u-tabular px-4 py-3 text-right"><Delta pct={row.medianDeltaPct} /></td>
                      <td className="u-micro u-tabular px-4 py-3 text-right text-ink">
                        {row.medianDaysOnMarket == null ? '—' : Math.round(row.medianDaysOnMarket)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
