import Link from 'next/link';
import { getPublishedPriceStats } from '@/lib/marketStats';
import { buildHref } from '@/lib/adminPagination';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, Stat, TD, TD_RIGHT, TH, TH_RIGHT, money } from '../LeadRoutingUI';
import EmptyChart from './EmptyChart';
import InfoTip from './InfoTip';

const PATH = '/admin/market-data';

function compactUsd(value) {
  if (value == null) return '—';
  const n = Number(value);
  if (n >= 1000000) return `$${(n / 1000000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  if (n >= 10000) return `$${Math.round(n / 1000).toLocaleString('fr-FR')} k`;
  return money(n);
}

/**
 * What the market is ASKING today, per commune — computed live from every
 * published listing (lib/marketStats.js). Sits above the closed-transaction
 * figures, which answer a different question (what deals closed at).
 *
 * Two charts, one series each, so no legend: median asking price per commune
 * as horizontal bars (the average rides beside it as text — two bars per row
 * would read as two series), and the distribution of asking prices as
 * columns. Every mark carries its exact value in a hover tooltip, and the
 * full figures sit in a table view underneath. Clicking a commune narrows the
 * distribution to it.
 */
export default async function PublishedPriceStats({ purpose, commune, params }) {
  const t = await getT();
  let stats = null;
  let error = null;
  try {
    stats = await getPublishedPriceStats({ purpose, commune });
  } catch (err) {
    error = err.message;
  }

  const unit = purpose === 'rent' ? t('admin.marketData.perMonth') : '';
  const maxMedian = Math.max(1, ...(stats?.communes || []).map((row) => row.medianPrice || 0));
  const maxBucket = Math.max(1, ...(stats?.buckets || []).map((bucket) => bucket.listings));
  const selectedRow = commune ? stats?.communes.find((row) => row.commune === commune) : null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <h2 className="u-title-section text-ink">{t('admin.marketData.publishedTitle')}</h2>
            <InfoTip label={t('admin.marketData.publishedTitle')}>{t('admin.marketData.publishedHelp')}</InfoTip>
          </div>
          <p className="u-micro mt-0.5 text-ink-45">{t('admin.marketData.publishedNote')}</p>
        </div>
        <div className="flex items-center gap-1.5" role="group" aria-label={t('admin.marketData.purpose')}>
          {['rent', 'sale'].map((value) => (
            <Link
              key={value}
              href={buildHref(PATH, params, { purpose: value === 'rent' ? '' : value, pc: '' })}
              scroll={false}
              aria-current={purpose === value ? 'page' : undefined}
              className={`u-press rounded-full px-3.5 py-1.5 text-[0.8125rem] font-bold transition-colors ${purpose === value ? 'bg-ink text-white' : 'bg-canvas-alt text-ink-70 hover:bg-canvas-deep'}`}
            >
              {value === 'rent' ? t('admin.marketData.rent') : t('admin.marketData.sale')}
              <span className="ml-1.5 u-tabular opacity-70">{stats?.purposes?.[value]?.listings ?? ''}</span>
            </Link>
          ))}
        </div>
      </div>

      {error ? <ErrorNote>{t('admin.marketData.publishedError', { error })}</ErrorNote> : null}

      {stats ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label={selectedRow ? t('admin.marketData.pricedIn', { commune }) : t('admin.marketData.pricedListings')}
              value={stats.overall.listings}
            />
            <Stat label={t('admin.marketData.medianAsking')} value={`${compactUsd(stats.overall.median_price)}${stats.overall.median_price != null ? unit : ''}`} />
            <Stat label={t('admin.marketData.averageAsking')} value={`${compactUsd(stats.overall.avg_price)}${stats.overall.avg_price != null ? unit : ''}`} />
            <Stat
              label={t('admin.marketData.unpriced')}
              value={stats.purposes?.[purpose]?.unpriced ?? 0}
              hint={t('admin.marketData.unpricedHint')}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="u-card flex flex-col gap-3 rounded-card bg-surface p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="u-title-card text-ink">{t('admin.marketData.medianByCommuneTitle')}</h3>
                {commune ? (
                  <Link href={buildHref(PATH, params, { pc: '' })} scroll={false} className="u-micro-strong text-blue-deep hover:underline">
                    {t('admin.marketData.clearCommune')}
                  </Link>
                ) : null}
              </div>
              {stats.communes.length === 0 ? (
                <EmptyChart variant="rows" message={t('admin.marketData.publishedEmpty')} />
              ) : (
                <ul className="flex flex-col gap-1">
                  {stats.communes.map((row) => {
                    const name = row.commune || t('admin.marketData.untagged');
                    const active = commune && row.commune === commune;
                    const tooltip = t('admin.marketData.communeTooltip', {
                      commune: name,
                      median: money(row.medianPrice),
                      average: money(row.avgPrice),
                      min: money(row.minPrice),
                      max: money(row.maxPrice),
                      count: row.listings,
                    });
                    const content = (
                      <>
                        <span className="u-micro truncate text-ink">{name}</span>
                        <span className="relative h-5">
                          <span
                            className={`absolute inset-y-0.5 left-0 rounded-r ${row.lowSample ? 'bg-blue/40' : 'bg-blue'} ${active ? 'ring-2 ring-blue-deep ring-offset-1' : ''}`}
                            style={{ width: `${Math.max(2, ((row.medianPrice || 0) / maxMedian) * 100)}%` }}
                          />
                        </span>
                        <span className="u-micro u-tabular whitespace-nowrap text-right text-ink-70">
                          <span className="font-semibold text-ink">{compactUsd(row.medianPrice)}</span>
                          <span className="text-ink-45"> · {t('admin.marketData.avgShort', { value: compactUsd(row.avgPrice) })} · n={row.listings}</span>
                        </span>
                      </>
                    );
                    return (
                      <li key={row.commune || 'untagged'}>
                        {row.commune ? (
                          <Link
                            href={buildHref(PATH, params, { pc: active ? '' : row.commune })}
                            scroll={false}
                            title={tooltip}
                            className={`grid grid-cols-[minmax(5rem,8rem)_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors hover:bg-canvas-alt ${active ? 'bg-blue-tint/50' : ''}`}
                          >
                            {content}
                          </Link>
                        ) : (
                          <div title={tooltip} className="grid grid-cols-[minmax(5rem,8rem)_minmax(0,1fr)_auto] items-center gap-2 px-1.5 py-0.5">
                            {content}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {stats.communes.some((row) => row.lowSample) ? (
                <p className="u-micro text-ink-45">{t('admin.marketData.lowSampleNote', { min: 5 })}</p>
              ) : null}
            </div>

            <div className="u-card flex flex-col gap-3 rounded-card bg-surface p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="u-title-card text-ink">
                  {commune ? t('admin.marketData.distributionInTitle', { commune }) : t('admin.marketData.distributionTitle')}
                </h3>
                <InfoTip label={t('admin.marketData.distributionTitle')}>{t('admin.marketData.distributionHelp')}</InfoTip>
              </div>
              {stats.overall.listings === 0 ? (
                <EmptyChart message={t('admin.marketData.publishedEmpty')} />
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex h-44 items-end gap-[2px] border-b border-line">
                    {stats.buckets.map((bucket) => {
                      const range = bucket.to == null ? `≥ ${compactUsd(bucket.from)}` : `${compactUsd(bucket.from)} – ${compactUsd(bucket.to)}`;
                      return (
                        <div
                          key={bucket.from}
                          className="group relative flex h-full flex-1 flex-col items-center justify-end"
                          title={t('admin.marketData.bucketTooltip', { range, count: bucket.listings })}
                        >
                          {bucket.listings > 0 ? (
                            <span className="u-micro u-tabular mb-0.5 text-ink-70">{bucket.listings}</span>
                          ) : null}
                          <span
                            className="w-full max-w-6 rounded-t bg-blue transition-opacity group-hover:opacity-80"
                            style={{ height: bucket.listings ? `${Math.max(3, (bucket.listings / maxBucket) * 85)}%` : '0%' }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-[2px]">
                    {stats.buckets.map((bucket) => (
                      <span key={bucket.from} className="flex-1 truncate text-center text-[0.625rem] text-ink-45">
                        {bucket.to == null ? `${compactUsd(bucket.from)}+` : compactUsd(bucket.from)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {stats.communes.length ? (
            <details className="u-card rounded-card bg-surface">
              <summary className="u-micro-strong cursor-pointer px-5 py-3 text-blue-deep">{t('admin.marketData.showTable')}</summary>
              <div className="overflow-x-auto border-t border-line">
                <table className="w-full min-w-[40rem] border-collapse">
                  <thead>
                    <tr className="border-b border-line">
                      <th className={TH}>{t('admin.marketData.colCommune')}</th>
                      <th className={TH_RIGHT}>{t('admin.marketData.colListings')}</th>
                      <th className={TH_RIGHT}>{t('admin.marketData.colMedian')}</th>
                      <th className={TH_RIGHT}>{t('admin.marketData.colAverage')}</th>
                      <th className={TH_RIGHT}>{t('admin.marketData.colMin')}</th>
                      <th className={TH_RIGHT}>{t('admin.marketData.colMax')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.communes.map((row) => (
                      <tr key={row.commune || 'untagged'} className="border-b border-line last:border-0">
                        <td className={`${TD} font-semibold text-ink`}>
                          {row.commune || t('admin.marketData.untagged')}
                          {row.lowSample ? <span className="ml-2"><Chip>{t('admin.marketData.lowSample')}</Chip></span> : null}
                        </td>
                        <td className={TD_RIGHT}>{row.listings}</td>
                        <td className={TD_RIGHT}>{money(row.medianPrice)}</td>
                        <td className={TD_RIGHT}>{money(row.avgPrice)}</td>
                        <td className={TD_RIGHT}>{money(row.minPrice)}</td>
                        <td className={TD_RIGHT}>{money(row.maxPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
