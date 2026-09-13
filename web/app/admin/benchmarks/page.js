import Link from 'next/link';
import { getAgentPerformance } from '@/lib/adminApi';
import { getT } from '@/lib/i18n/server';
import {
  Chip, ErrorNote, Panel, Stat, TD, TD_RIGHT, TH, TH_RIGHT, formatLatency, formatRate,
} from '../LeadRoutingUI';
import RoutingToggle from './RoutingToggle';

export const metadata = {
  title: 'Performance des agents — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const WINDOWS = [30, 90, 365];

/**
 * Agent leaderboard and accountability — and the switch that decides whether
 * an agent's listings route to them directly.
 *
 * The pricing medians that used to live on this URL moved to
 * /admin/market-data. Data comes from the engine's
 * GET /api/admin/benchmarks/agent-performance (services/agentPerformance.js),
 * so the leaderboard and the API report one definition of each rate.
 *
 * SCOPE, stated on the page: a lead here is a request that reached the agent
 * through our pipeline. A customer who taps a direct wa.me link talks to the
 * agent in a chat we never see, so that conversation cannot be timed.
 */
export default async function AgentPerformancePage({ searchParams }) {
  const t = await getT();
  const params = (await searchParams) || {};
  const days = WINDOWS.includes(Number(params.days)) ? Number(params.days) : 90;

  let data = null;
  let loadError = null;
  try {
    data = await getAgentPerformance({ days });
  } catch (err) {
    loadError = err.message;
  }

  const agents = data?.agents || [];
  const totals = data?.totals || {};

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.agentPerformance.title')}</h1>
          <p className="u-micro mt-1 max-w-3xl text-ink-45">{t('admin.agentPerformance.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          {WINDOWS.map((value) => (
            <Link
              key={value}
              href={`/admin/benchmarks?days=${value}`}
              className={`u-micro-strong rounded-full border px-3 py-1 ${value === days ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-surface text-ink-70 hover:border-blue'}`}
            >
              {t('admin.agentPerformance.window', { days: value })}
            </Link>
          ))}
        </div>
      </div>

      {loadError ? <ErrorNote>{t('admin.agentPerformance.loadError', { error: loadError })}</ErrorNote> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('admin.agentPerformance.avgResponse')} value={formatLatency(totals.avgLatencySeconds)} />
        <Stat label={t('admin.agentPerformance.leadToViewing')} value={formatRate(totals.leadToViewingPct)} />
        <Stat label={t('admin.agentPerformance.leads')} value={totals.leads ?? '—'} />
        <Stat
          label={t('admin.agentPerformance.directAgents')}
          value={data ? `${totals.directRoutingAgents}/${totals.agents}` : '—'}
        />
      </div>

      <p className="u-micro rounded-card border border-line bg-surface px-4 py-3 text-ink-70">
        {t('admin.agentPerformance.scopeNote')}
      </p>

      <Panel
        title={t('admin.agentPerformance.tableTitle')}
        isEmpty={agents.length === 0}
        emptyText={t('admin.agentPerformance.empty')}
      >
        <table className="w-full min-w-[64rem] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={TH}>{t('admin.agentPerformance.colAgent')}</th>
              <th className={TH}>{t('admin.agentPerformance.colVerification')}</th>
              <th className={TH}>{t('admin.agentPerformance.colRouting')}</th>
              <th className={TH_RIGHT}>{t('admin.agentPerformance.colLeads')}</th>
              <th className={TH_RIGHT}>{t('admin.agentPerformance.colResponseRate')}</th>
              <th className={TH_RIGHT}>{t('admin.agentPerformance.colLatency')}</th>
              <th className={TH_RIGHT}>{t('admin.agentPerformance.colConversion')}</th>
              <th className={TH_RIGHT}>{t('admin.agentPerformance.colFunnel')}</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.agentId} className="border-b border-line last:border-0">
                <td className={TD}>
                  <Link href={`/admin/agents/${agent.agentId}`} className="font-semibold text-blue-deep hover:underline">
                    {agent.name || `#${agent.agentId}`}
                  </Link>
                  <div className="u-tabular text-ink-45">{agent.phone ? `+${String(agent.phone).replace(/\D/g, '')}` : '—'}</div>
                </td>
                <td className={TD}>
                  {agent.phoneVerified ? (
                    <Chip tone="success">{t('admin.agentPerformance.verified')}</Chip>
                  ) : (
                    <Chip tone="warning">{t('admin.agentPerformance.unverified')}</Chip>
                  )}
                </td>
                <td className={TD}>
                  {agent.phoneVerified ? (
                    <RoutingToggle agentId={agent.agentId} agentName={agent.name} enabled={agent.directRoutingEnabled} />
                  ) : (
                    <span className="text-ink-45">{t('admin.agentPerformance.unverifiedRouting')}</span>
                  )}
                </td>
                <td className={TD_RIGHT}>{agent.leads}</td>
                <td className={TD_RIGHT}>{formatRate(agent.responseRatePct)}</td>
                <td className={TD_RIGHT}>{formatLatency(agent.avgLatencySeconds)}</td>
                <td className={TD_RIGHT}>{formatRate(agent.leadToViewingPct)}</td>
                <td className={`${TD_RIGHT} whitespace-nowrap`}>
                  {agent.leads} → {agent.viewings} → {agent.closedDeals}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
