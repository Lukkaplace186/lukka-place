import Link from 'next/link';
import { CLICK_PERIODS, DEFAULT_CLICK_PERIOD, parseClickPeriod } from '@/lib/analytics';
import { frNumber } from '@/lib/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { getTrafficSources } from '@/lib/trafficSources';
import { AD_CHANNELS, CHANNEL_COLORS, changePercent, chartSeries } from '@/lib/trafficChannels';
import { cn } from '@/lib/utils';
import { TD, TH, THEAD, TR } from '../tabs/TabSection';
import TrafficChart from './TrafficChart';

export const dynamic = 'force-dynamic';

function sourcesHref(periodKey) {
  return periodKey === DEFAULT_CLICK_PERIOD ? '/admin/dashboard/sources' : `/admin/dashboard/sources?periode=${periodKey}`;
}

function Change({ current, previous, t }) {
  const pct = changePercent(current, previous);
  if (previous === null || previous === undefined) return null;
  if (pct === null) {
    return current > 0 ? <span className="text-xs font-semibold text-success">{t('admin.trafficSources.new')}</span> : <span className="text-xs text-ink-45">—</span>;
  }
  const tone = pct > 0 ? 'text-success' : pct < 0 ? 'text-danger' : 'text-ink-45';
  return (
    <span className={cn('u-tabular whitespace-nowrap text-xs font-semibold', tone)}>
      {pct > 0 ? '+' : ''}{pct} %
    </span>
  );
}

function Tile({ label, value, current, previous, t, hint }) {
  return (
    <div className="rounded-card border border-line bg-white p-4">
      <p className="u-eyebrow text-ink-45">{label}</p>
      <p className="u-stat mt-1 text-ink">{value}</p>
      <p className="mt-1 flex flex-wrap items-baseline gap-1.5 text-xs text-ink-45">
        <Change current={current} previous={previous} t={t} />
        {previous !== null && previous !== undefined ? <span>{t('admin.trafficSources.vsBefore', { n: frNumber(previous) })}</span> : null}
        {hint ? <span>{hint}</span> : null}
      </p>
    </div>
  );
}

function ChannelName({ channel, t }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: CHANNEL_COLORS[channel] || '#CBD5E1' }} />
      <span className="text-ink">{t(`admin.trafficSources.channels.${channel}`)}</span>
      {AD_CHANNELS.has(channel) ? (
        <span className="rounded-full bg-blue/10 px-1.5 py-0.5 text-[11px] font-semibold text-blue">{t('admin.trafficSources.paidChip')}</span>
      ) : null}
    </span>
  );
}

function rate(taps, visitors) {
  if (!visitors) return null;
  return (taps / visitors) * 100;
}

function shortDay(value, locale) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
    day: 'numeric', month: 'short', timeZone: 'Africa/Kinshasa',
  }).format(new Date(value));
}

/**
 * Where visitors come from (2026-11-16, owner request): opened from the
 * dashboard's "Page views" tile, same periods. Channels, a per-day chart to
 * see an advert's effect, the tagged campaigns and agents' links, and the raw
 * sources behind them. Rules: lib/trafficChannels.js; data: lib/trafficSources.js.
 */
export default async function TrafficSourcesPage({ searchParams }) {
  const t = await getT();
  const locale = await getLocale();
  const sp = await searchParams;
  const period = parseClickPeriod(sp?.periode);
  const periodLabel = t(`admin.dashboard.periods.${period.key}`);
  const backHref = period.key === DEFAULT_CLICK_PERIOD ? '/admin/dashboard' : `/admin/dashboard?periode=${period.key}`;

  let data = null;
  try {
    data = await getTrafficSources({ sinceDays: period.days });
  } catch (error) {
    console.error(`[admin] traffic sources failed: ${error?.message}`);
  }

  const k = (key, vars) => t(`admin.trafficSources.${key}`, vars);
  const total = data?.total;
  const adVisitors = data ? data.channels.filter((r) => AD_CHANNELS.has(r.channel)).reduce((s, r) => s + r.visitors, 0) : 0;
  const maxVisitors = data ? Math.max(1, ...data.channels.map((r) => r.visitors)) : 1;
  const series = data ? chartSeries(data.channels) : { shown: [], folded: false };

  return (
    <div>
      <Link href={backHref} className="text-sm font-medium text-blue hover:underline">← {k('back')}</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{k('title')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-45">{k('intro')}</p>
        </div>
        <nav aria-label={t('admin.dashboard.period')} className="flex flex-wrap gap-1.5">
          {CLICK_PERIODS.map((p) => {
            const active = p.key === period.key;
            return (
              <Link
                key={p.key}
                href={sourcesHref(p.key)}
                scroll={false}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-medium',
                  active ? 'border-blue bg-blue text-white' : 'border-line bg-white text-ink hover:bg-canvas-alt',
                )}
              >
                {t(`admin.dashboard.periods.${p.key}`)}
              </Link>
            );
          })}
        </nav>
      </div>

      {!data ? (
        <div className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">{k('failed')}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Tile label={k('visitors', { period: periodLabel })} value={frNumber(total.visitors)} current={total.visitors} previous={total.prevVisitors} t={t} />
            <Tile label={k('views', { period: periodLabel })} value={frNumber(total.views)} current={total.views} previous={total.prevViews} t={t} />
            <Tile label={k('taps', { period: periodLabel })} value={frNumber(total.taps)} current={total.taps} previous={total.prevTaps} t={t} />
          </div>
          {total.visitors > 0 ? (
            <p className="mt-3 text-sm text-ink-70">
              {k('adShare', { ads: frNumber(adVisitors), pct: Math.round((adVisitors / total.visitors) * 100) })}
            </p>
          ) : null}

          <section className="mt-8">
            <h2 className="u-title-section text-ink">{k('channelsTitle')}</h2>
            <p className="mb-4 mt-1 max-w-3xl text-sm text-ink-45">{k('channelsNote')}</p>
            {data.channels.length === 0 ? (
              <div className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">{t('admin.dashboard.noData')}</div>
            ) : (
              <div className="overflow-x-auto rounded-card border border-line bg-white">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className={THEAD}>
                    <tr>
                      <th className={TH}>{k('channel')}</th>
                      <th className={TH}>{k('visitorsCol')}</th>
                      <th className={`${TH} text-right`}>{k('change')}</th>
                      <th className={`${TH} text-right`}>{k('viewsCol')}</th>
                      <th className={`${TH} text-right`}>{k('tapsCol')}</th>
                      <th className={`${TH} text-right`}>{k('contactRate')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.channels.map((row) => {
                      const r = rate(row.taps, row.visitors);
                      const share = total.visitors > 0 ? Math.round((row.visitors / total.visitors) * 100) : 0;
                      return (
                        <tr key={row.channel} className={TR}>
                          <td className={TD}><ChannelName channel={row.channel} t={t} /></td>
                          <td className={TD}>
                            <div className="flex items-center gap-3">
                              <span className="u-tabular w-12 shrink-0 whitespace-nowrap font-semibold text-ink">{frNumber(row.visitors)}</span>
                              <span className="h-2 w-32 shrink-0 overflow-hidden rounded-full bg-canvas-alt" aria-hidden="true">
                                <span className="block h-full rounded-full" style={{ width: `${(row.visitors / maxVisitors) * 100}%`, backgroundColor: CHANNEL_COLORS[row.channel] }} />
                              </span>
                              <span className="u-tabular whitespace-nowrap text-xs text-ink-45">{share} %</span>
                            </div>
                          </td>
                          <td className={`${TD} text-right`}>
                            <Change current={row.visitors} previous={row.prevVisitors} t={t} />
                          </td>
                          <td className={`${TD} u-tabular text-right text-ink-70`}>{frNumber(row.views)}</td>
                          <td className={`${TD} u-tabular text-right text-ink-70`}>{frNumber(row.taps)}</td>
                          <td className={`${TD} u-tabular text-right text-ink-70`}>{r === null ? '—' : `${r.toFixed(1)} %`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mt-8">
            <h2 className="u-title-section text-ink">{k(`chartTitle.${data.bucket}`)}</h2>
            <p className="mb-4 mt-1 max-w-3xl text-sm text-ink-45">{k('chartNote')}</p>
            <TrafficChart
              rows={data.timeline}
              bucket={data.bucket}
              days={period.days}
              shown={series.shown}
              folded={series.folded}
              locale={locale}
              labels={Object.fromEntries([...series.shown, 'rest'].map((c) => [c, c === 'rest' ? k('rest') : k(`channels.${c}`)]))}
              emptyLabel={t('admin.dashboard.noData')}
            />
          </section>

          <section className="mt-8">
            <h2 className="u-title-section text-ink">{k('campaignsTitle')}</h2>
            <p className="mb-4 mt-1 max-w-3xl text-sm text-ink-45">{k('campaignsNote')}</p>
            {data.campaigns.length === 0 ? (
              <div className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">{k('noCampaigns')}</div>
            ) : (
              <div className="overflow-x-auto rounded-card border border-line bg-white">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className={THEAD}>
                    <tr>
                      <th className={TH}>{k('campaign')}</th>
                      <th className={TH}>{k('channel')}</th>
                      <th className={`${TH} text-right`}>{k('visitorsCol')}</th>
                      <th className={`${TH} text-right`}>{k('change')}</th>
                      <th className={`${TH} text-right`}>{k('tapsCol')}</th>
                      <th className={TH}>{k('seen')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.campaigns.map((row) => (
                      <tr key={`${row.channel}|${row.campaign || ''}|${row.code || ''}`} className={TR}>
                        <td className={TD}>
                          {row.code ? (
                            <span className="text-ink">{k('agentCode')} <span className="u-ref font-semibold uppercase">{row.code}</span></span>
                          ) : /^[0-9]{12,}$/.test(row.campaign || '') ? (
                            <span className="text-ink">{k('metaCampaign')} <span className="u-ref select-all">{row.campaign}</span></span>
                          ) : (
                            <span className="u-ref text-ink">{row.campaign}</span>
                          )}
                        </td>
                        <td className={TD}><ChannelName channel={row.channel} t={t} /></td>
                        <td className={`${TD} u-tabular text-right font-semibold text-ink`}>{frNumber(row.visitors)}</td>
                        <td className={`${TD} text-right`}><Change current={row.visitors} previous={row.prevVisitors} t={t} /></td>
                        <td className={`${TD} u-tabular text-right text-ink-70`}>{frNumber(row.taps)}</td>
                        <td className={`${TD} whitespace-nowrap text-ink-70`}>
                          {shortDay(row.firstSeen, locale)} → {shortDay(row.lastSeen, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <details className="mt-8 rounded-card border border-line bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">{k('rawTitle')}</summary>
            <p className="px-4 pb-3 text-xs text-ink-45">{k('rawNote')}</p>
            <div className="overflow-x-auto border-t border-line">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className={THEAD}>
                  <tr>
                    <th className={TH}>{k('source')}</th>
                    <th className={TH}>{k('referrer')}</th>
                    <th className={TH}>{k('channel')}</th>
                    <th className={`${TH} text-right`}>{k('visitorsCol')}</th>
                    <th className={`${TH} text-right`}>{k('viewsCol')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.raw.map((row) => (
                    <tr key={`${row.channel}|${row.source}|${row.referrer_host || ''}`} className={TR}>
                      <td className={`${TD} u-ref text-ink`}>{row.source}</td>
                      <td className={`${TD} u-ref text-ink-70`}>{row.referrer_host || '—'}</td>
                      <td className={TD}><ChannelName channel={row.channel} t={t} /></td>
                      <td className={`${TD} u-tabular text-right text-ink`}>{frNumber(row.visitors)}</td>
                      <td className={`${TD} u-tabular text-right text-ink-70`}>{frNumber(row.views)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <ul className="mt-6 max-w-3xl list-disc space-y-1 pl-5 text-xs text-ink-45">
            <li>{k('howPeople')}</li>
            <li>{k('howAds')}</li>
            <li>{k('howAi')}</li>
            <li>{k('howTaps')}</li>
            <li>{k('howDirect')}</li>
          </ul>
        </>
      )}
    </div>
  );
}
