import { Download, Printer } from 'lucide-react';
import {
  FAST_RESPONSE_SECONDS,
  MIN_SAMPLE,
  getAcquisition,
  getDemand,
  getFunnelByMonth,
  getLiquidity,
  getResponsiveness,
  getRetention,
  getSupply,
  investorWindow,
} from '@/lib/investorMetrics';
import { frNumber } from '@/lib/format';
import { getT } from '@/lib/i18n/server';
import { getAdminSession } from '@/lib/adminSession';
import { can } from '@/lib/adminRoles';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { ErrorNote } from '../LeadRoutingUI';
import PrintButton from '../demande/PrintButton';
import DashboardPanel from '../dashboard/DashboardPanel';

export const dynamic = 'force-dynamic';

export const metadata = { robots: { index: false, follow: false } };

const TH = 'px-3 py-2.5 font-semibold whitespace-nowrap';
const TD = 'px-3 py-2 u-tabular whitespace-nowrap';
const THEAD = 'border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45';
const TR = 'border-b border-line last:border-b-0';

/** null → an em dash: not measured, or below the sample size. Never 0. */
const num = (value) => (value === null || value === undefined ? '—' : frNumber(value));
const pct = (value) =>
  value === null || value === undefined ? '—' : `${frNumber(value * 100, { maximumFractionDigits: 0 })} %`;
/** Days as "6 h" under a day, "2,5 j" above. */
function duration(days, k) {
  if (days === null || days === undefined) return '—';
  if (days < 1) return k('units.hours', { n: frNumber(Math.max(1, Math.round(days * 24))) });
  return k('units.days', { n: frNumber(days, { maximumFractionDigits: 1 }) });
}
const decimal = (value) => (value === null || value === undefined ? '—' : frNumber(value, { maximumFractionDigits: 1 }));

function monthLabel(month, locale) {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function dayLabel(value, locale) {
  if (!value) return null;
  return new Date(value).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Kinshasa',
  });
}

function Tile({ label, value, hint }) {
  return (
    <div className="rounded-card border border-line bg-white p-4">
      <p className="u-eyebrow text-ink-45">{label}</p>
      <p className="u-stat mt-1 text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-45">{hint}</p> : null}
    </div>
  );
}

function Section({ title, definition, children }) {
  return (
    <section className="mt-8 break-inside-avoid-page">
      <h2 className="u-title-section text-ink">{title}</h2>
      {definition ? <p className="mb-3 mt-1 max-w-3xl text-sm text-ink-45">{definition}</p> : null}
      {children}
    </section>
  );
}

function Unavailable({ t, result }) {
  if (result.status === 'rejected') {
    return <ErrorNote>{t('admin.investors.loadFailed', { message: result.reason?.message || '' })}</ErrorNote>;
  }
  return <ErrorNote>{t('admin.investors.notMeasured')}</ErrorNote>;
}

export default async function InvestorsPage() {
  const t = await getT();
  const session = await getAdminSession();
  const canExport = can(session?.role, 'data.export');
  const locale = t.locale;
  const k = (key, vars) => t(`admin.investors.${key}`, vars);

  // Every window starts at launch at the earliest: what came before is
  // pre-launch testing on listings that no longer exist.
  const win = await investorWindow();
  const { months, demandDays, responseDays, starts } = win;
  const [funnelR, supplyR, liquidityR, demandR, retentionR, responseR, acquisitionR] = await Promise.allSettled([
    getFunnelByMonth(months, win.launch),
    getSupply(months, win.launch),
    getLiquidity(),
    getDemand({ days: demandDays, launch: win.launch }),
    getRetention(months, win.launch),
    getResponsiveness({ days: responseDays, launch: win.launch }),
    getAcquisition({ days: demandDays, launch: win.launch }),
  ]);
  const ok = (r) => r.status === 'fulfilled' && r.value !== null;
  const supply = ok(supplyR) ? supplyR.value : null;
  const liquidity = ok(liquidityR) ? liquidityR.value : null;
  const demand = ok(demandR) ? demandR.value : null;
  const response = ok(responseR) ? responseR.value : null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{k('title')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-45">{k('intro', { min: MIN_SAMPLE })}</p>
          <p className="mt-1 text-xs text-ink-45">
            {k('generatedOn', { date: dayLabel(new Date(), locale) })}
            {win.launch ? ` ${k('sinceLaunch', { date: dayLabel(win.launch, locale) })}` : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <PrintButton label={k('print')} icon={<Printer size={16} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />} />
          {canExport ? (
          <a
            href="/admin/export/investors"
            className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-sm font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-line)]"
          >
            <Download size={16} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
            {k('exportCsv')}
          </a>
          ) : null}
        </div>
      </div>

      {/* Headline figures */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label={k('tiles.liveListings')}
          value={num(supply?.snapshot.liveListings)}
          hint={supply ? k('tiles.liveListingsHint', { agents: frNumber(supply.snapshot.agentsWithLive) }) : null}
        />
        <Tile
          label={k('tiles.verifiedAgents')}
          value={num(supply?.snapshot.verifiedAgents)}
          hint={supply ? k('tiles.verifiedAgentsHint', { active: frNumber(supply.snapshot.activeAgents) }) : null}
        />
        <Tile
          label={k('tiles.leadRate')}
          value={pct(liquidity?.leadRate30d)}
          hint={
            liquidity
              ? k('tiles.leadRateHint', { withLead: frNumber(liquidity.withLead30d), count: frNumber(liquidity.liveListings) })
              : null
          }
        />
        <Tile
          label={k('tiles.zeroResults')}
          value={pct(demand?.zeroShare)}
          hint={demand ? k('tiles.zeroResultsHint', { days: demandDays, count: frNumber(demand.searches) }) : null}
        />
      </div>

      {/* 1. Funnel */}
      <Section title={k('funnelTitle')} definition={k('funnelDefinition')}>
        {funnelR.status === 'rejected' ? (
          <Unavailable t={t} result={funnelR} />
        ) : (
          <DashboardPanel title={k('funnelTableTitle', { months: months })} isEmpty={funnelR.value.length === 0}>
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>{k('col.month')}</th>
                  <th className={`${TH} text-right`}>{k('col.visitors')}</th>
                  <th className={`${TH} text-right`}>{k('col.listingViews')}</th>
                  <th className={`${TH} text-right`}>{k('col.searches')}</th>
                  <th className={`${TH} text-right`}>{k('col.zeroResults')}</th>
                  <th className={`${TH} text-right`}>{k('col.whatsapp')}</th>
                  <th className={`${TH} text-right`}>{k('col.calls')}</th>
                  <th className={`${TH} text-right`}>{k('col.visitRequests')}</th>
                  <th className={`${TH} text-right`}>{k('col.closes')}</th>
                </tr>
              </thead>
              <tbody>
                {funnelR.value.map((row) => (
                  <tr key={row.month} className={TR}>
                    <td className={`${TD} text-ink`}>{monthLabel(row.month, locale)}</td>
                    <td className={`${TD} text-right text-ink`}>{num(row.visitors)}</td>
                    <td className={`${TD} text-right text-ink-70`}>{num(row.listingViews)}</td>
                    <td className={`${TD} text-right text-ink-70`}>{num(row.searches)}</td>
                    <td className={`${TD} text-right text-ink-70`}>{num(row.zeroResults)}</td>
                    <td className={`${TD} text-right text-ink`}>{num(row.whatsapp)}</td>
                    <td className={`${TD} text-right text-ink-70`}>{num(row.calls)}</td>
                    <td className={`${TD} text-right text-ink-70`}>{num(row.visitRequests)}</td>
                    <td className={`${TD} text-right text-ink-70`}>{num(row.closes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DashboardPanel>
        )}
        <p className="mt-2 text-xs text-ink-45">{k('funnelNote')}</p>
      </Section>

      {/* 2. Liquidity */}
      <Section title={k('liquidityTitle')} definition={k('liquidityDefinition', { min: MIN_SAMPLE })}>
        {!liquidity ? (
          <Unavailable t={t} result={liquidityR} />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label={k('tiles.leadRate')}
              value={pct(liquidity.leadRate30d)}
              hint={k('liquidity.leadRateHint', {
                withLead: frNumber(liquidity.withLead30d),
                count: frNumber(liquidity.liveListings),
                mature: frNumber(liquidity.matureListings),
                matureRate: pct(liquidity.matureLeadRate30d),
              })}
            />
            <Tile
              label={k('liquidity.daysToLead')}
              value={duration(liquidity.medianDaysToFirstLead, k)}
              hint={k('liquidity.daysToLeadHint', {
                withLead: frNumber(liquidity.listingsWithLead),
                count: frNumber(liquidity.trackedListings),
              })}
            />
            <Tile
              label={k('liquidity.daysOnMarket')}
              value={num(liquidity.medianDaysOnMarket === null ? null : Math.round(liquidity.medianDaysOnMarket))}
              hint={k('liquidity.closesHint', { count: frNumber(liquidity.closes) })}
            />
            <Tile
              label={k('liquidity.priceGap')}
              value={
                liquidity.medianPriceGap === null
                  ? '—'
                  : `${liquidity.medianPriceGap > 0 ? '+' : liquidity.medianPriceGap < 0 ? '−' : ''}${frNumber(
                      Math.abs(liquidity.medianPriceGap * 100),
                      { maximumFractionDigits: 1 },
                    )} %`
              }
              hint={k('liquidity.priceGapHint', { count: frNumber(liquidity.pricedCloses) })}
            />
          </div>
        )}
      </Section>

      {/* 3. Supply */}
      <Section title={k('supplyTitle')} definition={k('supplyDefinition')}>
        {!supply ? (
          <Unavailable t={t} result={supplyR} />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label={k('tiles.liveListings')} value={num(supply.snapshot.liveListings)} />
              <Tile label={k('supply.activeAgents')} value={num(supply.snapshot.activeAgents)} />
              <Tile label={k('supply.cities')} value={num(supply.snapshot.cities)} />
              <Tile label={k('supply.communes')} value={num(supply.snapshot.communes)} />
            </div>
            <DashboardPanel title={k('supplyTableTitle')} isEmpty={supply.byMonth.length === 0}>
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className={THEAD}>
                  <tr>
                    <th className={TH}>{k('col.month')}</th>
                    <th className={`${TH} text-right`}>{k('col.newListings')}</th>
                    <th className={`${TH} text-right`}>{k('col.cumulativeListings')}</th>
                    <th className={`${TH} text-right`}>{k('col.newAgents')}</th>
                    <th className={`${TH} text-right`}>{k('col.verifiedAgents')}</th>
                  </tr>
                </thead>
                <tbody>
                  {supply.byMonth.map((row) => (
                    <tr key={row.month} className={TR}>
                      <td className={`${TD} text-ink`}>{monthLabel(row.month, locale)}</td>
                      <td className={`${TD} text-right text-ink`}>{num(row.newListings)}</td>
                      <td className={`${TD} text-right text-ink-70`}>{num(row.cumulativeListings)}</td>
                      <td className={`${TD} text-right text-ink`}>{num(row.newAgents)}</td>
                      <td className={`${TD} text-right text-ink-70`}>{num(row.verifiedAgents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DashboardPanel>
          </>
        )}
      </Section>

      {/* 4. Unmet demand */}
      <Section title={k('demandTitle')} definition={k('demandDefinition', { days: demandDays })}>
        {!demand ? (
          <Unavailable t={t} result={demandR} />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label={k('demand.searches')} value={num(demand.searches)} />
              <Tile label={k('demand.searchers')} value={num(demand.searchers)} />
              <Tile label={k('demand.zeroSearches')} value={num(demand.zeroResults)} hint={pct(demand.zeroShare)} />
              <Tile label={k('demand.zeroSearchers')} value={num(demand.zeroSearchers)} />
            </div>
            <DashboardPanel title={k('unmetTableTitle')} isEmpty={demand.unmet.length === 0}>
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className={THEAD}>
                  <tr>
                    <th className={TH}>{k('col.commune')}</th>
                    <th className={TH}>{k('col.purpose')}</th>
                    <th className={TH}>{k('col.type')}</th>
                    <th className={`${TH} text-right`}>{k('col.searchers')}</th>
                    <th className={`${TH} text-right`}>{k('col.searches')}</th>
                    <th className={`${TH} text-right`}>{k('col.medianBudget')}</th>
                  </tr>
                </thead>
                <tbody>
                  {demand.unmet.map((row, i) => (
                    <tr key={`${row.commune}-${row.purpose}-${row.propertyType}-${i}`} className={TR}>
                      <td className={`${TD} text-ink`}>{row.commune || k('anyCommune')}</td>
                      <td className={`${TD} text-ink-70`}>
                        {row.purpose === 'rent' ? k('purpose.rent') : row.purpose === 'sale' ? k('purpose.sale') : k('purpose.any')}
                      </td>
                      <td className={`${TD} text-ink-70`}>{row.propertyType || k('anyType')}</td>
                      <td className={`${TD} text-right text-ink`}>{num(row.searchers)}</td>
                      <td className={`${TD} text-right text-ink-70`}>{num(row.searches)}</td>
                      <td className={`${TD} text-right text-ink-70`}>
                        {row.medianBudget === null ? '—' : `${frNumber(Math.round(row.medianBudget))} $`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DashboardPanel>
          </>
        )}
      </Section>

      {/* 5. Retention */}
      <Section title={k('retentionTitle')} definition={k('retentionDefinition')}>
        {retentionR.status === 'rejected' ? (
          <Unavailable t={t} result={retentionR} />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <DashboardPanel title={k('visitorReturnTitle')} isEmpty={retentionR.value.visitors.length === 0}>
              <table className="w-full min-w-[320px] text-left text-sm">
                <thead className={THEAD}>
                  <tr>
                    <th className={TH}>{k('col.month')}</th>
                    <th className={`${TH} text-right`}>{k('col.newVisitors')}</th>
                    <th className={`${TH} text-right`}>{k('col.returned')}</th>
                    <th className={`${TH} text-right`}>{k('col.rate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {retentionR.value.visitors.map((row) => (
                    <tr key={row.month} className={TR}>
                      <td className={`${TD} text-ink`}>{monthLabel(row.month, locale)}</td>
                      <td className={`${TD} text-right text-ink`}>{num(row.newVisitors)}</td>
                      <td className={`${TD} text-right text-ink-70`}>{num(row.returned)}</td>
                      <td className={`${TD} text-right text-ink-70`}>{pct(row.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DashboardPanel>
            <DashboardPanel title={k('agentRepeatTitle')} isEmpty={retentionR.value.agents.length === 0}>
              <table className="w-full min-w-[320px] text-left text-sm">
                <thead className={THEAD}>
                  <tr>
                    <th className={TH}>{k('col.month')}</th>
                    <th className={`${TH} text-right`}>{k('col.newPublishers')}</th>
                    <th className={`${TH} text-right`}>{k('col.publishedAgain')}</th>
                    <th className={`${TH} text-right`}>{k('col.rate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {retentionR.value.agents.map((row) => (
                    <tr key={row.month} className={TR}>
                      <td className={`${TD} text-ink`}>
                        {monthLabel(row.month, locale)}
                        {row.complete ? null : <span className="ml-1 text-ink-45">*</span>}
                      </td>
                      <td className={`${TD} text-right text-ink`}>{num(row.newPublishers)}</td>
                      <td className={`${TD} text-right text-ink-70`}>{num(row.publishedAgain)}</td>
                      <td className={`${TD} text-right text-ink-70`}>{pct(row.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DashboardPanel>
          </div>
        )}
        <p className="mt-2 text-xs text-ink-45">{k('retentionNote')}</p>
      </Section>

      {/* 6. Agent responsiveness */}
      <Section
        title={k('responseTitle')}
        definition={k('responseDefinition', { days: responseDays, minutes: FAST_RESPONSE_SECONDS / 60, min: MIN_SAMPLE })}
      >
        {!response ? (
          <Unavailable t={t} result={responseR} />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={k('response.requests')} value={num(response.requests)} />
            <Tile label={k('response.answerRate')} value={pct(response.answerRate)} hint={k('response.answeredHint', { count: frNumber(response.answered) })} />
            <Tile label={k('response.median')} value={response.medianMinutes === null ? '—' : `${decimal(response.medianMinutes)} min`} />
            <Tile label={k('response.fast', { minutes: FAST_RESPONSE_SECONDS / 60 })} value={pct(response.fastRate)} />
          </div>
        )}
      </Section>

      {/* 7. Acquisition */}
      <Section title={k('acquisitionTitle')} definition={k('acquisitionDefinition', { days: demandDays })}>
        {acquisitionR.status === 'rejected' ? (
          <Unavailable t={t} result={acquisitionR} />
        ) : (
          <DashboardPanel title={k('acquisitionTableTitle')} isEmpty={acquisitionR.value.length === 0}>
            <table className="w-full min-w-[440px] text-left text-sm">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>{k('col.source')}</th>
                  <th className={`${TH} text-right`}>{k('col.visitors')}</th>
                  <th className={`${TH} text-right`}>{k('col.views')}</th>
                  <th className={`${TH} text-right`}>{k('col.whatsapp')}</th>
                  <th className={`${TH} text-right`}>{k('col.tapsPerView')}</th>
                </tr>
              </thead>
              <tbody>
                {acquisitionR.value.map((row) => (
                  <tr key={row.source} className={TR}>
                    <td className={`${TD} text-ink`}>
                      {row.source === 'direct' ? t('admin.dashboard.direct') : row.source === 'inconnu' ? k('unknownSource') : row.source}
                    </td>
                    <td className={`${TD} text-right text-ink`}>{num(row.visitors)}</td>
                    <td className={`${TD} text-right text-ink-70`}>{num(row.views)}</td>
                    <td className={`${TD} text-right text-ink`}>{num(row.taps)}</td>
                    <td className={`${TD} text-right text-ink-70`}>{pct(row.tapRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DashboardPanel>
        )}
        <p className="mt-2 text-xs text-ink-45">{k('acquisitionNote')}</p>
      </Section>

      {/* 8. When each measurement began */}
      <Section title={k('sinceTitle')} definition={k('sinceDefinition')}>
        <ul className="grid gap-1 text-sm text-ink-70 sm:grid-cols-2">
          {[
            ['launch', starts.launch],
            ['views', starts.views],
            ['whatsapp', starts.whatsapp],
            ['visitors', starts.visitors],
            ['searches', starts.searches],
            ['rollup', starts.rollup],
          ].map(([key, value]) => (
            <li key={key}>
              <span className="text-ink">{k(`since.${key}`)}</span> : {dayLabel(value, locale) || k('notYet')}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
