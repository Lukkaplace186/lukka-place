import Link from 'next/link';
import { listViewingFeed } from '@/lib/adminApi';
import { getLeadClickTotals, getRecentLeadClicks } from '@/lib/adminLeadRouting';
import { ROUTING_TYPE_LABEL_KEYS } from '@/lib/adminLabels';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, Panel, ROUTING_TONE, Stat, TD, TH, formatKinshasa } from '../LeadRoutingUI';
import NudgeButton from './NudgeButton';

export const metadata = {
  title: 'Télémétrie — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/** Mirrors the engine's services/viewingSweeps.js CHECKIN_AFTER_MS. */
const CHECKIN_AFTER_MS = 2 * 60 * 60 * 1000;

const CHECKIN_ANSWER_KEYS = {
  GOOD: 'admin.telemetry.answerGood',
  BAD: 'admin.telemetry.answerBad',
  AGENT_ABSENT: 'admin.telemetry.answerAbsent',
};

/**
 * System logs and the re-engagement queue.
 *
 * The follow-ups shown are the ones the engine really runs — the 15-minute
 * unanswered-request alert and the check-in two hours after a confirmed slot
 * (services/viewingSweeps.js). There is no separate 24-hour job, and this page
 * does not pretend there is one.
 */
export default async function AdminTelemetryPage() {
  const t = await getT();

  const [totals, clicks, feed] = await Promise.all([
    getLeadClickTotals({ days: 30 }),
    getRecentLeadClicks({ limit: 100 }),
    listViewingFeed({ limit: 100 }).catch((err) => ({ error: err.message })),
  ]);

  const requests = feed?.data || [];
  const awaitingAgent = requests.filter(
    (row) => row.routing_type === 'DIRECT_WA' && ['PENDING', 'RESCHEDULED'].includes(row.status) && !row.first_response_at,
  );
  const followUps = requests.filter((row) => row.scheduled_at && ['CONFIRMED', 'COMPLETED'].includes(row.status));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.telemetry.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.telemetry.subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('admin.telemetry.clicks30')} value={totals.total} />
        <Stat label={t('admin.telemetry.direct')} value={totals.DIRECT_WA} />
        <Stat label={t('admin.telemetry.central')} value={totals.CENTRAL_FALLBACK} />
        <Stat label={t('admin.telemetry.unknown')} value={totals.UNKNOWN} />
      </div>

      <Panel title={t('admin.telemetry.clicksTitle')} isEmpty={clicks.length === 0} emptyText={t('admin.telemetry.clicksEmpty')}>
        <table className="w-full min-w-[48rem] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={TH}>{t('admin.telemetry.colTime')}</th>
              <th className={TH}>{t('admin.telemetry.colListing')}</th>
              <th className={TH}>{t('admin.telemetry.colRouting')}</th>
              <th className={TH}>{t('admin.telemetry.colDevice')}</th>
              <th className={TH}>{t('admin.telemetry.colSource')}</th>
            </tr>
          </thead>
          <tbody>
            {clicks.map((click) => (
              <tr key={click.id} className="border-b border-line last:border-0">
                <td className={`${TD} whitespace-nowrap`}>{formatKinshasa(click.created_at)}</td>
                <td className={TD}>
                  {click.listing_id ? (
                    <Link href={`/admin/listings/${click.listing_id}`} className="font-semibold text-blue-deep hover:underline">
                      {click.reference ? `Réf: ${click.reference}` : `#${click.listing_id}`}
                    </Link>
                  ) : '—'}
                  {click.title ? <div className="max-w-[18rem] truncate text-ink-45">{click.title}</div> : null}
                </td>
                <td className={TD}>
                  {click.routing_type ? (
                    <Chip tone={ROUTING_TONE[click.routing_type]}>{t(ROUTING_TYPE_LABEL_KEYS[click.routing_type])}</Chip>
                  ) : (
                    <span className="text-ink-35">{t('admin.telemetry.unknown')}</span>
                  )}
                </td>
                <td className={TD}>{click.device || '—'}</td>
                <td className={TD}>{click.source || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {feed?.error ? <ErrorNote>{t('admin.telemetry.engineError', { error: feed.error })}</ErrorNote> : null}

      <Panel
        title={t('admin.telemetry.nudgeTitle')}
        note={t('admin.telemetry.nudgeNote')}
        isEmpty={awaitingAgent.length === 0}
        emptyText={t('admin.telemetry.nudgeEmpty')}
      >
        <table className="w-full min-w-[40rem] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={TH}>{t('admin.telemetry.colRequest')}</th>
              <th className={TH}>{t('admin.telemetry.colReceived')}</th>
              <th className={TH}>{t('admin.telemetry.colSla')}</th>
              <th className={TH}>{t('admin.viewings.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {awaitingAgent.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-0">
                <td className={TD}>
                  <Link href={`/admin/viewings?status=${row.status}`} className="font-semibold text-blue-deep hover:underline">
                    #{row.id}
                  </Link>
                  <div className="text-ink-45">{row.lead_name || (row.lead_wa_id ? `+${row.lead_wa_id}` : '')}</div>
                </td>
                <td className={`${TD} whitespace-nowrap`}>{formatKinshasa(row.created_at)}</td>
                <td className={TD}>
                  {row.sla_alerted_at ? (
                    <Chip tone="danger">{t('admin.telemetry.slaSent', { time: formatKinshasa(row.sla_alerted_at) })}</Chip>
                  ) : (
                    <Chip tone="warning">{t('admin.telemetry.slaPending')}</Chip>
                  )}
                </td>
                <td className={TD}><NudgeButton viewingRequestId={row.id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel
        title={t('admin.telemetry.checkinTitle')}
        note={t('admin.telemetry.checkinNote')}
        isEmpty={followUps.length === 0}
        emptyText={t('admin.telemetry.checkinEmpty')}
      >
        <table className="w-full min-w-[40rem] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={TH}>{t('admin.telemetry.colRequest')}</th>
              <th className={TH}>{t('admin.telemetry.colSlot')}</th>
              <th className={TH}>{t('admin.telemetry.colCheckin')}</th>
              <th className={TH}>{t('admin.telemetry.colAnswer')}</th>
            </tr>
          </thead>
          <tbody>
            {followUps.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-0">
                <td className={TD}>#{row.id}</td>
                <td className={`${TD} whitespace-nowrap`}>{formatKinshasa(row.scheduled_at)}</td>
                <td className={TD}>
                  {row.checkin_sent_at ? (
                    <Chip tone="success">{t('admin.telemetry.checkinSent')} · {formatKinshasa(row.checkin_sent_at)}</Chip>
                  ) : (
                    <Chip tone="warning">
                      {t('admin.telemetry.checkinDue')} · {formatKinshasa(new Date(new Date(row.scheduled_at).getTime() + CHECKIN_AFTER_MS))}
                    </Chip>
                  )}
                </td>
                <td className={TD}>
                  {row.checkin_response ? t(CHECKIN_ANSWER_KEYS[row.checkin_response]) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
