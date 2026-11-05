import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { getAdminSession } from '@/lib/adminSession';
import { can } from '@/lib/adminRoles';
import { firstParam } from '@/lib/adminPagination';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { getMarketComparison, getSourceSummary, listObservations } from '@/lib/marketGuide';
import {
  COLLECTED_SOURCES,
  MANUAL_SOURCES,
  MARKET_SOURCES,
  MARKET_WINDOW_DAYS,
  SOURCE_NAMES,
  STILL_LISTED_DAYS,
} from '@/lib/marketObservationRules';
import { MIN_PRICE_SAMPLE } from '@/lib/browseFeatures';
import publishedEstimates from '@/lib/data/published-rent-estimates.json';
import { Chip, ErrorNote, Panel, Stat, TD, TD_RIGHT, TH, TH_RIGHT, formatKinshasa, money } from '../../LeadRoutingUI';
import ObservationEntryForm from './ObservationEntryForm';
import MarketPasteBatch from './MarketPasteBatch';
import ExclusionControl from './ExclusionControl';

export const metadata = {
  title: 'Prix du marché — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const pct = (a, b) => (a && b ? Math.round(((a - b) / b) * 100) : null);

/**
 * "Prix du marché": asking prices seen outside Lukka Place's own listings
 * (lib/marketGuide.js, engine services/marketObservations.js) — where each
 * source stands, how our listings compare with the rest of the market by
 * commune, what third parties publish, hand entry for Facebook / Zwandako,
 * and the list a team member reviews and excludes from.
 */
export default async function MarketObservationsPage({ searchParams }) {
  const t = await getT();
  const session = await getAdminSession();
  const canManage = can(session?.role, 'market.manage');
  const raw = (await searchParams) || {};
  const source = MARKET_SOURCES.includes(firstParam(raw.source)) ? firstParam(raw.source) : null;
  const commune = firstParam(raw.commune) || null;
  const state = ['counted', 'excluded'].includes(firstParam(raw.state)) ? firstParam(raw.state) : null;
  const page = Math.max(1, Number.parseInt(firstParam(raw.page), 10) || 1);

  const [summary, comparison, list, hierarchy] = await Promise.all([
    getSourceSummary().catch((err) => ({ error: err.message, rows: [] })),
    getMarketComparison().catch((err) => ({ error: err.message, rows: [] })),
    listObservations({ source, commune, state, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }).catch((err) => ({ error: err.message, rows: [], total: 0 })),
    getLocationHierarchyWithFallback({ city: 'all' }),
  ]);

  const notMigrated = summary.available === false;
  const bySource = Object.fromEntries((summary.rows || []).map((row) => [row.source, row]));
  const totals = (summary.rows || []).reduce((acc, row) => ({ total: acc.total + row.total, live: acc.live + row.live_rents }), { total: 0, live: 0 });
  const comparable = (comparison.rows || []).filter((row) => row.lukka_n + row.market_n >= MIN_PRICE_SAMPLE);
  const pages = Math.max(1, Math.ceil((list.total || 0) / PAGE_SIZE));
  const href = (changes) => {
    const params = new URLSearchParams();
    const next = { source, commune, state, page: 1, ...changes };
    for (const [key, value] of Object.entries(next)) if (value && !(key === 'page' && value === 1)) params.set(key, value);
    const query = params.toString();
    return `/admin/market-data/marche${query ? `?${query}` : ''}`;
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/admin/market-data" className="u-micro-strong text-ink-70 hover:text-ink">{t('admin.marketData.title')}</Link>
        <h1 className="u-title-page mt-1 text-ink">{t('admin.marketObservations.title')}</h1>
        <p className="u-micro mt-1 max-w-3xl text-ink-45">
          {t('admin.marketObservations.subtitle', { days: MARKET_WINDOW_DAYS, live: STILL_LISTED_DAYS })}
        </p>
      </div>

      {notMigrated ? <ErrorNote>{t('admin.marketObservations.notMigrated')}</ErrorNote> : null}
      {summary.error ? <ErrorNote>{summary.error}</ErrorNote> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('admin.marketObservations.statTotal')} value={totals.total} />
        <Stat label={t('admin.marketObservations.statLive')} value={totals.live} hint={t('admin.marketObservations.statLiveHint', { live: STILL_LISTED_DAYS })} />
        <Stat label={t('admin.marketObservations.statCommunes')} value={comparable.length} hint={t('admin.marketObservations.statCommunesHint', { n: MIN_PRICE_SAMPLE })} />
        <Stat label={t('admin.marketObservations.statSources')} value={(summary.rows || []).filter((row) => row.usable > 0).length} />
      </div>

      <Panel title={t('admin.marketObservations.sourcesTitle')} note={t('admin.marketObservations.sourcesNote')}>
        <table className="w-full min-w-[48rem] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={TH}>{t('admin.marketObservations.colSource')}</th>
              <th className={TH}>{t('admin.marketObservations.colHow')}</th>
              <th className={TH_RIGHT}>{t('admin.marketObservations.colStored')}</th>
              <th className={TH_RIGHT}>{t('admin.marketObservations.colLiveRents')}</th>
              <th className={TH_RIGHT}>{t('admin.marketObservations.colExcluded')}</th>
              <th className={TH}>{t('admin.marketObservations.colLastRun')}</th>
            </tr>
          </thead>
          <tbody>
            {[...COLLECTED_SOURCES, ...MANUAL_SOURCES].map((key) => {
              const row = bySource[key];
              return (
                <tr key={key} className="border-b border-line last:border-0">
                  <td className={`${TD} font-semibold text-ink`}>
                    <Link href={href({ source: key })} className="hover:underline">{SOURCE_NAMES[key]}</Link>
                  </td>
                  <td className={TD}>
                    {COLLECTED_SOURCES.includes(key)
                      ? <Chip tone="blue">{t('admin.marketObservations.howCollected')}</Chip>
                      : <Chip>{t('admin.marketObservations.howManual')}</Chip>}
                  </td>
                  <td className={TD_RIGHT}>{row?.total ?? 0}</td>
                  <td className={TD_RIGHT}>{row?.live_rents ?? 0}</td>
                  <td className={TD_RIGHT}>{row?.excluded ?? 0}</td>
                  <td className={TD}>
                    {row?.last_error ? (
                      <span className="text-danger">{t('admin.marketObservations.runFailed', { error: row.last_error.slice(0, 120) })}</span>
                    ) : row?.last_ok_at ? formatKinshasa(row.last_ok_at)
                      : COLLECTED_SOURCES.includes(key) ? <span className="text-ink-35">{t('admin.marketObservations.neverRun')}</span> : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <Panel
        title={t('admin.marketObservations.comparisonTitle')}
        note={t('admin.marketObservations.comparisonNote', { n: MIN_PRICE_SAMPLE })}
        isEmpty={comparable.length === 0}
        emptyText={t('admin.marketObservations.comparisonEmpty')}
      >
        <table className="w-full min-w-[44rem] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={TH}>{t('admin.marketData.colCommune')}</th>
              <th className={TH_RIGHT}>{t('admin.marketObservations.colBeds')}</th>
              <th className={TH_RIGHT}>{t('admin.marketObservations.colLukka')}</th>
              <th className={TH_RIGHT}>{t('admin.marketObservations.colMarket')}</th>
              <th className={TH_RIGHT}>{t('admin.marketObservations.colGap')}</th>
            </tr>
          </thead>
          <tbody>
            {comparable.map((row) => {
              const lukkaShown = row.lukka_n >= MIN_PRICE_SAMPLE;
              const marketShown = row.market_n >= MIN_PRICE_SAMPLE;
              const gap = lukkaShown && marketShown ? pct(row.lukka_median, row.market_median) : null;
              return (
                <tr key={`${row.commune}-${row.beds}`} className="border-b border-line last:border-0">
                  <td className={`${TD} font-semibold text-ink`}>
                    <Link href={href({ commune: row.commune })} className="hover:underline">{row.commune}</Link>
                  </td>
                  <td className={TD_RIGHT}>{row.beds}</td>
                  <td className={TD_RIGHT}>
                    {lukkaShown ? money(row.lukka_median) : <span className="text-ink-35">—</span>}
                    <span className="text-ink-35"> ({row.lukka_n})</span>
                  </td>
                  <td className={TD_RIGHT}>
                    {marketShown ? money(row.market_median) : <span className="text-ink-35">—</span>}
                    <span className="text-ink-35"> ({row.market_n})</span>
                  </td>
                  <td className={TD_RIGHT}>{gap === null ? '—' : `${gap > 0 ? '+' : ''}${gap} %`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <Panel title={t('admin.marketObservations.estimatesTitle')} note={t('admin.marketObservations.estimatesNote')}>
        <div className="flex flex-col gap-4 p-4">
          {publishedEstimates.estimates.map((estimate) => (
            <div key={estimate.id} className="flex flex-col gap-2">
              <p className="u-micro-strong text-ink">
                <a href={estimate.url} target="_blank" rel="noopener noreferrer" className="text-blue-deep hover:underline">
                  {estimate.publisher} — {estimate.title}
                </a>
                <span className="font-normal text-ink-45"> · {t('admin.marketObservations.estimateDates', { published: estimate.publishedOn, retrieved: estimate.retrievedOn })}</span>
              </p>
              <ul className="u-micro flex flex-wrap gap-x-5 gap-y-1 text-ink-70">
                {estimate.citywide.map((row) => (
                  <li key={row.label}>{row.label} : <span className="u-tabular font-semibold text-ink">{money(row.average)}</span> ({money(row.low)}–{money(row.high)})</li>
                ))}
                {estimate.communes.map((row) => (
                  <li key={row.commune}>{row.scope} : <span className="u-tabular font-semibold text-ink">{money(row.average)}</span></li>
                ))}
              </ul>
              <ul className="u-micro list-disc pl-5 text-ink-45">
                {estimate.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Panel>

      {canManage && !notMigrated ? (
        <section className="flex flex-col gap-2" id="coller">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="u-title-card text-ink">{t('admin.marketPaste.title')}</h2>
            <Link href="/admin/market-data/prospects" className="u-micro-strong text-blue-deep hover:underline">{t('admin.marketPaste.prospectsLink')} →</Link>
          </div>
          <p className="u-micro max-w-3xl text-ink-45">{t('admin.marketPaste.note')}</p>
          <MarketPasteBatch communes={hierarchy.communes} sources={MANUAL_SOURCES.map((key) => ({ key, name: SOURCE_NAMES[key] }))} />
        </section>
      ) : null}

      {canManage && !notMigrated ? (
        <section className="flex flex-col gap-2">
          <h2 className="u-title-card text-ink">{t('admin.marketObservations.entryTitle')}</h2>
          <p className="u-micro max-w-3xl text-ink-45">{t('admin.marketObservations.entryNote')}</p>
          <ObservationEntryForm communes={hierarchy.communes} sources={MANUAL_SOURCES.map((key) => ({ key, name: SOURCE_NAMES[key] }))} />
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="u-title-card text-ink">{t('admin.marketObservations.listTitle', { n: list.total || 0 })}</h2>
          <Link href={href({ state: null })} className={`u-micro-strong rounded-full border px-3 py-1 ${!state ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line text-ink-70'}`}>{t('admin.marketObservations.filterAll')}</Link>
          <Link href={href({ state: 'counted' })} className={`u-micro-strong rounded-full border px-3 py-1 ${state === 'counted' ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line text-ink-70'}`}>{t('admin.marketObservations.filterCounted')}</Link>
          <Link href={href({ state: 'excluded' })} className={`u-micro-strong rounded-full border px-3 py-1 ${state === 'excluded' ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line text-ink-70'}`}>{t('admin.marketObservations.filterExcluded')}</Link>
          {source || commune ? (
            <Link href={href({ source: null, commune: null })} className="u-micro text-ink-45 hover:text-ink">
              {[source && SOURCE_NAMES[source], commune].filter(Boolean).join(' · ')} ✕
            </Link>
          ) : null}
        </div>
        {list.error ? <ErrorNote>{list.error}</ErrorNote> : null}
        <div className="u-card overflow-x-auto rounded-card bg-surface">
          <table className="w-full min-w-[60rem] border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={TH}>{t('admin.marketObservations.colSource')}</th>
                <th className={TH}>{t('admin.marketObservations.colSeen')}</th>
                <th className={TH}>{t('admin.marketData.colCommune')}</th>
                <th className={TH}>{t('admin.marketObservations.colWhat')}</th>
                <th className={TH_RIGHT}>{t('admin.marketObservations.colPrice')}</th>
                <th className={TH}>{t('admin.marketObservations.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {(list.rows || []).map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className={TD}>
                    {row.source_url ? (
                      <a href={row.source_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-deep hover:underline">{SOURCE_NAMES[row.source]}</a>
                    ) : row.property_id ? (
                      <Link href={`/admin/listings/${row.property_id}`} className="font-semibold text-blue-deep hover:underline">{SOURCE_NAMES[row.source]} · #{row.property_id}</Link>
                    ) : <span className="font-semibold text-ink">{SOURCE_NAMES[row.source]}</span>}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{formatKinshasa(row.posted_at || row.first_seen_at)}</td>
                  <td className={TD}>{row.commune || <span className="text-ink-35">{t('admin.marketObservations.noCommune')}</span>}{row.quartier ? <div className="text-ink-45">{row.quartier}</div> : null}</td>
                  <td className={TD}>
                    {[row.purpose === 'sale' ? t('admin.marketObservations.sale') : t('admin.marketObservations.rent'), row.property_kind, row.beds !== null ? t('admin.marketObservations.beds', { n: row.beds }) : null, row.furnished ? t('admin.marketObservations.furnished') : null].filter(Boolean).join(' · ')}
                    {row.title ? <div className="max-w-[22rem] truncate text-ink-45">{row.title}</div> : null}
                  </td>
                  <td className={TD_RIGHT}>
                    {row.monthly_usd ? t('admin.marketObservations.perMonth', { amount: money(row.monthly_usd) }) : row.price ? `${money(row.price)}${row.currency === 'CDF' ? ' FC' : ''}${row.price_period && row.price_period !== 'total' ? ` / ${row.price_period}` : ''}` : '—'}
                  </td>
                  <td className={TD}>
                    <ExclusionControl id={row.id} reason={row.excluded_reason} canManage={canManage} />
                  </td>
                </tr>
              ))}
              {(list.rows || []).length === 0 ? (
                <tr><td colSpan={6} className={`${TD} py-8 text-center text-ink-45`}>{t('admin.marketObservations.listEmpty')}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {pages > 1 ? (
          <div className="u-micro flex items-center gap-3 text-ink-70">
            {page > 1 ? <Link href={href({ page: page - 1 })} className="hover:text-ink">← {t('admin.marketObservations.previous')}</Link> : null}
            <span>{t('admin.marketObservations.pageOf', { page, pages })}</span>
            {page < pages ? <Link href={href({ page: page + 1 })} className="hover:text-ink">{t('admin.marketObservations.next')} →</Link> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
