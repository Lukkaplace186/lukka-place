import { TrendingDown, TrendingUp } from 'lucide-react';
import { getMarketBenchmarks, benchmarkTotals, MIN_SAMPLE } from '@/lib/marketBenchmarks';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

/**
 * Internal benchmark pricing.
 *
 * Deliberately admin-only and `robots: noindex`. This is the raw material of
 * the data product — achieved prices nobody else holds for Kinshasa — and the
 * moment it renders on a public page it stops being sellable and starts being
 * something competitors read for free. It sits behind the same
 * ADMIN_SESSION_COOKIE gate as /admin/export/listings.csv.
 *
 * Expect this page to be largely empty at launch. There are very few closed
 * transactions recorded so far, and the suppression rule in
 * lib/marketBenchmarks.js hides a median until MIN_SAMPLE sales support it.
 * An empty table here is an accurate report on the market record, not a
 * broken page — the alternative, showing a "median" of two sales, is the one
 * thing that would make this dataset worth less than nothing.
 */

export const metadata = {
  title: 'Prix de référence — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

function Stat({ label, value, hint }) {
  return (
    <div className="u-card rounded-card bg-surface p-4">
      <div className="u-eyebrow text-ink-45">{label}</div>
      <div className="u-stat mt-1.5 text-ink">{value}</div>
      {hint ? <div className="u-micro mt-1 text-ink-45">{hint}</div> : null}
    </div>
  );
}

/** USD, no decimals — these are medians of asking/achieved prices. */
function money(value) {
  if (value == null) return '—';
  return `$${Math.round(value).toLocaleString('fr-FR')}`;
}

/**
 * The negotiation gap, which is the commercially interesting figure here and
 * the only one that carries a direction. Negative means the property sold
 * BELOW its asking price, which is the normal case and should not read as an
 * error.
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

export default async function BenchmarksPage() {
  const t = await getT();
  const rows = await getMarketBenchmarks();
  const totals = benchmarkTotals(rows);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.benchmarks.title')}</h1>
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

      <section className="flex flex-col gap-2">
        <h2 className="u-title-card text-ink">{t('admin.benchmarks.tableTitle')}</h2>

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
                  <tr
                    key={`${row.commune}|${row.purpose}|${row.propertyType}`}
                    className="border-b border-line last:border-0"
                  >
                    <td className="u-micro-strong px-4 py-3 text-ink">{row.commune}</td>
                    <td className="u-micro px-4 py-3 text-ink">{row.purpose}</td>
                    <td className="u-micro px-4 py-3 text-ink">{row.propertyType || '—'}</td>
                    <td className="u-micro u-tabular px-4 py-3 text-right text-ink">{row.sample}</td>
                    {row.suppressed ? (
                      // The count is real and stays; the medians do not exist
                      // yet and are not invented. One cell spanning the four
                      // says that more plainly than four dashes would.
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
    </div>
  );
}
