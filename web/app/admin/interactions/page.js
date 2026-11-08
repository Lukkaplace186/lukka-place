import Link from 'next/link';
import { getAgentInteractions } from '@/lib/agentInteractions';
import { getAdminSession } from '@/lib/adminSession';
import { can } from '@/lib/adminRoles';
import { buildHref, firstParam } from '@/lib/adminPagination';
import { INTERACTION_CHANNELS, INTERACTION_WINDOWS, interactionWindow } from '@/lib/interactionCounts';
import { getT } from '@/lib/i18n/server';
import { ErrorNote } from '../LeadRoutingUI';
import InfoTip from '../market-data/InfoTip';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../table/TableFrame';
import IntroductionForm from './IntroductionForm';

export const metadata = {
  title: 'Interactions — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const PATH = '/admin/interactions';
/** Rows rendered; the totals above always cover every agent. */
const MAX_ROWS = 200;

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

/**
 * Interactions clients → agents: how many times customers reached an agent,
 * as one number and per agent, plus the form that records the ones that
 * happened outside our systems. The counting rules are lib/interactionCounts.js.
 */
export default async function AdminInteractionsPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const days = interactionWindow(firstParam(raw.days));
  const session = await getAdminSession();
  const canRecord = can(session?.role, 'leads.manage');

  const { counts, names, errors } = await getAgentInteractions({ days });
  const rows = counts.agents.slice(0, MAX_ROWS);
  const hidden = counts.agents.length - rows.length;
  const channelKeys = INTERACTION_CHANNELS.map((c) => c.key);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.interactions.title')}</h1>
          <p className="u-micro mt-1 text-ink-45">{t('admin.interactions.subtitle')}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {INTERACTION_WINDOWS.map((value) => (
            <Link
              key={value}
              href={buildHref(PATH, {}, { days: value === 30 ? '' : value })}
              aria-current={value === days ? 'page' : undefined}
              className={`u-press rounded-full px-3.5 py-1.5 text-[0.8125rem] font-bold transition-colors ${value === days ? 'bg-ink text-white' : 'bg-canvas-alt text-ink-70 hover:bg-canvas-deep'}`}
            >
              {t('admin.matching.rangeDays', { days: value })}
            </Link>
          ))}
        </div>
      </div>

      {errors.engine ? <ErrorNote>{t('admin.interactions.engineError', { error: errors.engine })}</ErrorNote> : null}
      {errors.taps ? <ErrorNote>{t('admin.interactions.databaseError', { error: errors.taps })}</ErrorNote> : null}

      <section className="grid gap-3 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="u-card flex flex-col gap-2 rounded-card bg-surface p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="u-eyebrow text-ink-45">{t('admin.interactions.totalTitle', { days })}</span>
            <InfoTip label={t('admin.interactions.totalTitle', { days })}>{t('admin.interactions.totalHelp')}</InfoTip>
          </div>
          <div className="u-stat text-ink">{fmt(counts.total)}</div>
          <p className="u-micro text-ink-70">{t('admin.interactions.agentsReached', { count: counts.agents.filter((a) => a.agentId).length })}</p>
          {counts.answerable ? (
            <p className="u-micro text-ink-70">{t('admin.interactions.answered', { contacted: fmt(counts.contacted), total: fmt(counts.answerable) })}</p>
          ) : null}
          {counts.tapAlerts.alerted ? (
            <p className="u-micro text-ink-70">
              {t('admin.interactions.tapAlerts', {
                alerted: fmt(counts.tapAlerts.alerted),
                replied: fmt(counts.tapAlerts.replied),
                nothing: fmt(counts.tapAlerts.nothing),
              })}
            </p>
          ) : null}
          {counts.central.whatsapp || counts.central.call ? (
            <p className="u-micro border-t border-line pt-2 text-ink-45">
              {t('admin.interactions.central', { whatsapp: fmt(counts.central.whatsapp), call: fmt(counts.central.call) })}
            </p>
          ) : null}
        </div>

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {channelKeys.map((key) => (
            <li key={key} className="u-card flex flex-col gap-1 rounded-card bg-surface p-4">
              <span className="u-eyebrow text-ink-45">{t(`admin.interactions.channels.${key}`)}</span>
              <span className="u-stat text-ink">{fmt(counts.channels[key])}</span>
              <span className="u-micro text-ink-45">{t(`admin.interactions.channelHelp.${key}`)}</span>
            </li>
          ))}
        </ul>
      </section>

      {canRecord ? <IntroductionForm /> : null}

      <section className="flex flex-col gap-2">
        <div>
          <h2 className="u-title-card text-ink">{t('admin.interactions.perAgentTitle')}</h2>
          <p className="u-micro mt-0.5 text-ink-45">{t('admin.interactions.perAgentNote')}</p>
        </div>
        <TableFrame minWidth="64rem">
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.interactions.agent')}</th>
              {channelKeys.map((key) => (
                <th key={key} className={TH_STICKY_RIGHT}>{t(`admin.interactions.short.${key}`)}</th>
              ))}
              <th className={TH_STICKY_RIGHT}>{t('admin.interactions.total')}</th>
              <th className={TH_STICKY_RIGHT} title={t('admin.interactions.tapRepliedHelp')}>{t('admin.interactions.tapReplied')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={channelKeys.length + 3}>{t('admin.interactions.empty', { days })}</EmptyRow>
            ) : rows.map((row) => (
              <tr key={row.agentId ?? 'none'} className={TR_DENSE}>
                <td className={TD_DENSE}>
                  {row.agentId ? (
                    <Link href={`/admin/agents/${row.agentId}`} className="font-semibold text-blue-deep hover:underline">
                      {names.get(row.agentId) || t('admin.interactions.agentFallback', { id: row.agentId })}
                    </Link>
                  ) : (
                    <span className="text-ink-45">{t('admin.interactions.noAgent')}</span>
                  )}
                </td>
                {channelKeys.map((key) => (
                  <td key={key} className={TD_DENSE_RIGHT}>{row.channels[key] ? fmt(row.channels[key]) : <span className="text-ink-35">·</span>}</td>
                ))}
                <td className={`${TD_DENSE_RIGHT} font-bold text-ink`}>{fmt(row.total)}</td>
                <td className={TD_DENSE_RIGHT}>
                  {row.tapAlerts.alerted
                    ? `${fmt(row.tapAlerts.replied)} / ${fmt(row.tapAlerts.alerted)}`
                    : <span className="text-ink-35">·</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
        {hidden > 0 ? <p className="u-micro text-ink-45">{t('admin.interactions.moreAgents', { count: hidden })}</p> : null}
      </section>

      <p className="u-micro text-ink-45">{t('admin.interactions.notCounted')}</p>
    </div>
  );
}
