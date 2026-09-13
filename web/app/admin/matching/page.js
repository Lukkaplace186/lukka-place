import Link from 'next/link';
import { AlertTriangle, Radar } from 'lucide-react';
import { getMatchingStats, listLeadMatches } from '@/lib/adminApi';
import { getAgentNamesByIds } from '@/lib/agents';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { buildHref, firstParam, parsePage } from '@/lib/adminPagination';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, Panel, Stat, TD, TH, formatKinshasa, money } from '../LeadRoutingUI';
import Pagination from '../table/Pagination';
import TableToolbar from '../table/TableToolbar';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../table/TableFrame';

export const metadata = {
  title: 'Attribution — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const RANGE_DAYS = [7, 30, 90];
const MATCH_STATUSES = ['NOTIFIED', 'FAILED', 'ANSWERED', 'UNANSWERED'];
const MATCH_STATUS_LABEL_KEYS = {
  NOTIFIED: 'admin.matching.statusNotified',
  FAILED: 'admin.matching.statusFailed',
  ANSWERED: 'admin.matching.statusAnswered',
  UNANSWERED: 'admin.matching.statusUnanswered',
};

function pct(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 100);
}

function budgetText(row) {
  if (row.price_min == null && row.price_max == null) return null;
  if (row.price_min != null && row.price_max != null) return `${money(row.price_min)} – ${money(row.price_max)}`;
  return row.price_max != null ? `≤ ${money(row.price_max)}` : `≥ ${money(row.price_min)}`;
}

/**
 * The matching console — how the automated agent push is actually performing.
 *
 * The number this page exists for is "demandes sans agence", the coverage
 * gap: customer requests in a commune where no registered agency has signed
 * up to take work. That is the only figure that tells you where to go
 * recruit.
 *
 * Every figure is a real count from `lead_matches` and `lead_proposals` (the
 * engine's own tables — see services/leadDispatch.js). The matches table is
 * one server-side page (LIMIT/OFFSET in the engine), filterable by commune,
 * budget overlap, dispatch score and outcome.
 *
 * The 500 this page used to throw was `const t = stats.totals` shadowing the
 * translator one line before `t('admin.matching.requestsReceived')` — every
 * render, for every admin. The totals are `totals` now. Each data source is
 * also loaded independently: the engine failing renders an ErrorNote in place,
 * and app/admin/error.js catches anything else inside the console shell.
 */
export default async function AdminMatchingPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const days = RANGE_DAYS.includes(Number(firstParam(raw.days))) ? Number(firstParam(raw.days)) : 30;
  const filters = {
    days: days === 30 ? undefined : String(days),
    commune: firstParam(raw.commune) || undefined,
    budget_min: firstParam(raw.budget_min) || undefined,
    budget_max: firstParam(raw.budget_max) || undefined,
    min_score: firstParam(raw.min_score) || undefined,
    status: MATCH_STATUSES.includes(firstParam(raw.status)) ? firstParam(raw.status) : undefined,
  };
  const { page, pageSize, limit, offset } = parsePage(raw);
  const params = { ...filters, page: page > 1 ? String(page) : undefined, size: pageSize === 25 ? undefined : String(pageSize) };

  const [statsResult, matchesResult] = await Promise.allSettled([
    getMatchingStats({ days }),
    listLeadMatches({
      days,
      commune: filters.commune,
      budgetMin: filters.budget_min,
      budgetMax: filters.budget_max,
      minScore: filters.min_score,
      status: filters.status,
      limit,
      offset,
    }),
  ]);
  const stats = statsResult.status === 'fulfilled' ? statsResult.value : null;
  const matches = matchesResult.status === 'fulfilled' ? matchesResult.value : null;
  const statsError = statsResult.status === 'rejected' ? statsResult.reason?.message : null;
  const matchesError = matchesResult.status === 'rejected' ? matchesResult.reason?.message : null;

  const agentIds = [
    ...(stats?.byAgent || []).map((row) => row.agent_id),
    ...(matches?.data || []).map((row) => row.agent_id),
  ];
  const agentNames = await getAgentNamesByIds(agentIds).catch(() => new Map());
  const agentLabel = (id) => agentNames.get(Number(id))?.name || `Agent #${id}`;

  const totals = stats?.totals;
  const undispatched = totals ? Math.max(0, totals.leads - totals.leads_dispatched) : 0;
  const responseRate = totals ? pct(totals.proposals, totals.pushes) : null;
  const scoreRange = matches?.facets?.scoreRange;
  const communeOptions = (matches?.facets?.communes || []).map((row) => ({
    value: row.commune || '__none__',
    label: `${row.commune || t('admin.matching.communeUnknown')} (${row.n})`,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.matching.title')}</h1>
          <p className="u-micro mt-1 text-ink-45">{t('admin.matching.lead')}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {RANGE_DAYS.map((value) => (
            <Link
              key={value}
              href={buildHref('/admin/matching', params, { days: value === 30 ? '' : value })}
              aria-current={value === days ? 'page' : undefined}
              className={`u-press rounded-full px-3.5 py-1.5 text-[0.8125rem] font-bold transition-colors ${
                value === days ? 'bg-ink text-white' : 'bg-canvas-alt text-ink-70 hover:bg-canvas-deep'
              }`}
            >
              {t('admin.matching.rangeDays', { days: value })}
            </Link>
          ))}
        </div>
      </div>

      {statsError ? (
        <ErrorNote>{t('admin.matching.engineUnreachable')} — {statsError}</ErrorNote>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t('admin.matching.requestsReceived')} value={totals.leads} hint={t('admin.matching.overDays', { days })} />
            <Stat
              label={t('admin.matching.requestsMatched')}
              value={totals.leads_dispatched}
              hint={totals.leads ? t('admin.matching.matchedShare', { pct: pct(totals.leads_dispatched, totals.leads) }) : null}
            />
            <Stat
              label={t('admin.matching.agentAlertsSent')}
              value={totals.pushes}
              hint={totals.failed_pushes ? t('admin.matching.failedSends', { count: totals.failed_pushes }) : t('admin.matching.noFailedSends')}
            />
            <Stat
              label={t('admin.matching.responseRate')}
              value={responseRate == null ? '—' : `${responseRate}%`}
              hint={t('admin.matching.proposalsBack', { count: totals.proposals })}
            />
          </div>

          {undispatched > 0 && (
            <div className="rounded-card border border-warning/40 bg-warning-tint p-5">
              <div className="flex items-center gap-2">
                <AlertTriangle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-warning" />
                <h2 className="u-title-card text-warning">{t('admin.matching.uncoveredTitle', { count: undispatched })}</h2>
              </div>
              <p className="u-micro mt-1.5 text-ink-70">{t('admin.matching.coverageGapBody')}</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {stats.uncovered.map((row) => (
                  <li key={row.commune} className="u-micro-strong rounded-full bg-surface px-3 py-1 text-ink">
                    {row.commune} · {row.n}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="u-title-card text-ink">{t('admin.matching.matchesTitle')}</h2>
          <p className="u-micro mt-0.5 text-ink-45">{t('admin.matching.matchesNote')}</p>
        </div>

        <TableToolbar
          params={params}
          filters={[
            { type: 'select', param: 'commune', label: t('admin.matching.colCommune'), options: communeOptions },
            { type: 'number', param: 'budget_min', label: t('admin.matching.budgetMin'), placeholder: '$', min: 0, step: 50 },
            { type: 'number', param: 'budget_max', label: t('admin.matching.budgetMax'), placeholder: '$', min: 0, step: 50 },
            {
              type: 'number',
              param: 'min_score',
              label: t('admin.matching.minScore'),
              placeholder: scoreRange?.max != null ? `≤ ${Math.round(scoreRange.max)}` : '',
              min: 0,
              step: 5,
            },
            {
              type: 'select',
              param: 'status',
              label: t('admin.matching.colOutcome'),
              options: MATCH_STATUSES.map((value) => ({ value, label: t(MATCH_STATUS_LABEL_KEYS[value]) })),
            },
          ]}
        />

        {matchesError ? <ErrorNote>{t('admin.matching.matchesError', { error: matchesError })}</ErrorNote> : null}

        <TableFrame
          minWidth="68rem"
          footer={matches ? (
            <Pagination pathname="/admin/matching" params={params} total={matches.total} page={page} pageSize={pageSize} />
          ) : null}
        >
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.matching.colRequest')}</th>
              <th className={TH_STICKY}>{t('admin.matching.colCommune')}</th>
              <th className={TH_STICKY}>{t('admin.matching.colBudget')}</th>
              <th className={TH_STICKY}>{t('admin.matching.colAgency')}</th>
              <th className={TH_STICKY_RIGHT}>{t('admin.matching.colScore')}</th>
              <th className={TH_STICKY}>{t('admin.matching.colOutcome')}</th>
              <th className={TH_STICKY}>{t('admin.matching.colProposed')}</th>
              <th className={TH_STICKY}>{t('admin.matching.colSent')}</th>
            </tr>
          </thead>
          <tbody>
            {(matches?.data || []).length === 0 ? (
              <EmptyRow colSpan={8}>{t('admin.matching.matchesEmpty')}</EmptyRow>
            ) : (
              matches.data.map((row) => (
                <tr key={row.id} className={TR_DENSE}>
                  <td className={TD_DENSE}>
                    <Link href={`/admin/leads/${row.lead_id}`} className="font-semibold text-blue-deep hover:underline">
                      #{row.lead_id}
                    </Link>
                    <div className="max-w-[12rem] truncate text-ink">{row.lead_name || '—'}</div>
                    <div className="u-tabular text-ink-45">{row.lead_wa_id ? `+${row.lead_wa_id}` : ''}</div>
                  </td>
                  <td className={TD_DENSE}>{row.commune || <span className="text-ink-35">{t('admin.matching.communeUnknown')}</span>}</td>
                  <td className={`${TD_DENSE} u-tabular whitespace-nowrap`}>
                    {budgetText(row) || '—'}
                    {row.bedrooms ? <div className="text-ink-45">{t('admin.matching.bedrooms', { count: row.bedrooms })}</div> : null}
                  </td>
                  <td className={TD_DENSE}>
                    <Link href={`/admin/agents/${row.agent_id}`} className="font-semibold text-ink hover:text-blue-deep hover:underline">
                      {agentLabel(row.agent_id)}
                    </Link>
                    <div className="text-ink-45">{row.rank != null ? t('admin.matching.rank', { rank: row.rank }) : ''}</div>
                  </td>
                  <td className={TD_DENSE_RIGHT}>{row.score == null ? '—' : Math.round(row.score)}</td>
                  <td className={TD_DENSE}>
                    {row.status === 'FAILED' ? (
                      <span title={row.error || undefined}><Chip tone="danger">{t('admin.matching.statusFailed')}</Chip></span>
                    ) : row.proposed_property_id ? (
                      <Chip tone="success">{t('admin.matching.statusAnswered')}</Chip>
                    ) : (
                      <Chip tone="blue">{t('admin.matching.statusNotified')}</Chip>
                    )}
                  </td>
                  <td className={TD_DENSE}>
                    {row.proposed_property_id ? (
                      <Link href={`/admin/listings/${row.proposed_property_id}`} className="font-semibold text-blue-deep hover:underline">
                        #{row.proposed_property_id}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>{formatKinshasa(row.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </TableFrame>
      </section>

      {stats ? (
        <>
          <Panel
            title={t('admin.matching.byCommuneTitle')}
            note={t('admin.matching.byCommuneNote')}
            isEmpty={stats.byCommune.length === 0}
            emptyText={t('admin.matching.byCommuneEmpty', { days })}
          >
            <table className="w-full min-w-[36rem] border-collapse">
              <thead className="bg-canvas-alt">
                <tr>
                  <th className={TH}>{t('admin.matching.colCommune')}</th>
                  <th className={TH}>{t('admin.matching.colRequests')}</th>
                  <th className={TH}>{t('admin.matching.alertsSent')}</th>
                  <th className={TH}>{t('admin.matching.responses')}</th>
                  <th className={TH}>{t('admin.matching.colCoverage')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.byCommune.map((row) => (
                  <tr key={row.commune} className="border-t border-line">
                    <td className={`${TD} font-semibold text-ink`}>{row.commune}</td>
                    <td className={`${TD} u-tabular`}>{row.leads}</td>
                    <td className={`${TD} u-tabular`}>{row.pushes}</td>
                    <td className={`${TD} u-tabular`}>{row.answers}</td>
                    <td className={TD}>
                      {row.pushes === 0 ? (
                        <Chip tone="danger">{t('admin.matching.noAgency')}</Chip>
                      ) : (
                        <Chip tone="success">{t('admin.matching.covered')}</Chip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel
            title={t('admin.matching.agencyResponsiveness')}
            note={t('admin.matching.agencyResponsivenessNote')}
            isEmpty={stats.byAgent.length === 0}
            emptyText={t('admin.matching.byAgentEmpty')}
          >
            <table className="w-full min-w-[36rem] border-collapse">
              <thead className="bg-canvas-alt">
                <tr>
                  <th className={TH}>{t('admin.matching.colAgency')}</th>
                  <th className={TH}>{t('admin.matching.alertsReceived')}</th>
                  <th className={TH}>{t('admin.matching.responses')}</th>
                  <th className={TH}>{t('admin.matching.colRate')}</th>
                  <th className={TH}>{t('admin.matching.colBestRank')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.byAgent.map((row) => {
                  const rate = pct(row.answers, row.pushes);
                  return (
                    <tr key={row.agent_id} className="border-t border-line">
                      <td className={TD}>
                        <Link href={`/admin/agents/${row.agent_id}`} className="font-semibold text-ink hover:text-blue-deep hover:underline">
                          {agentLabel(row.agent_id)}
                        </Link>
                        <div className="u-micro u-tabular text-ink-35">{row.agent_phone || '—'}</div>
                      </td>
                      <td className={`${TD} u-tabular`}>{row.pushes}</td>
                      <td className={`${TD} u-tabular`}>{row.answers}</td>
                      <td className={TD}>
                        <Chip tone={rate == null ? 'neutral' : rate >= 50 ? 'success' : rate > 0 ? 'warning' : 'danger'}>
                          {rate == null ? '—' : `${rate}%`}
                        </Chip>
                      </td>
                      <td className={`${TD} u-tabular`}>{row.best_rank ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        </>
      ) : null}

      <div className="u-card flex items-start gap-3 rounded-card bg-surface p-5">
        <Radar strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-5 w-5 shrink-0 text-blue" />
        <div className="u-micro leading-relaxed text-ink-70">
          <p className="font-bold text-ink">{t('admin.matching.howRankingWorks')}</p>
          <p className="mt-1">{t('admin.matching.rankingExplained')}</p>
        </div>
      </div>
    </div>
  );
}
