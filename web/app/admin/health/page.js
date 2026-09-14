import { CheckCircle2, CircleAlert, CircleX } from 'lucide-react';
import { getEngineHealth } from '@/lib/adminApi';
import { getPool } from '@/lib/db';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { formatKinshasa } from '../LeadRoutingUI';
import { TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../table/TableFrame';

export const dynamic = 'force-dynamic';

const HOUR = 3600 * 1000;

function renderTime() {
  return Date.now();
}

function sqliteDate(value) {
  if (!value) return null;
  const text = String(value);
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) || text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function timed(fn) {
  const started = Date.now();
  try {
    const value = await fn();
    return { ok: true, ms: Date.now() - started, value };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err.message };
  }
}

function StatusIcon({ level }) {
  if (level === 'ok') return <CheckCircle2 strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 text-success" />;
  if (level === 'warn') return <CircleAlert strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 text-warning" />;
  return <CircleX strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 text-danger" />;
}

/**
 * System health, from what the platform itself records — not synthetic pings.
 * Postgres and the engine are timed live; everything else is the engine's own
 * account of its scheduled jobs, its most recent inbound traffic, and its send
 * failures. A "last inbound WhatsApp message" that is many hours old is how a
 * broken webhook shows up before a customer complains.
 *
 * Alerts: the engine's ops-health-alerts sweep (services/opsAlerts.js) turns
 * the same report into incidents — opened once, resolved once — and WhatsApps
 * the desk when OPS_WHATSAPP_NUMBER is set. Open incidents always show here and
 * as the Health badge in the sidebar, so an unset number degrades to "visible
 * in the console", never to "fired into nothing".
 */
export default async function AdminHealthPage() {
  const t = await getT();
  const [postgres, engine, rate] = await Promise.all([
    timed(() => getPool().query('SELECT 1')),
    timed(() => getEngineHealth()),
    timed(() => getPool().query('SELECT MAX(updated_at) AS at FROM exchange_rates').then((r) => r.rows[0]?.at || null)),
  ]);
  const health = engine.ok ? engine.value : null;
  const now = renderTime();
  const lastInbound = sqliteDate(health?.traffic?.lastInboundMessageAt);
  const lastListing = sqliteDate(health?.traffic?.lastListingAt);
  const newestTraffic = [lastInbound, lastListing].filter(Boolean).sort((a, b) => b - a)[0] || null;

  const checks = [
    { key: 'postgres', level: postgres.ok ? (postgres.ms > 1500 ? 'warn' : 'ok') : 'down', detail: postgres.ok ? `${postgres.ms} ms` : postgres.error },
    { key: 'engine', level: engine.ok ? (engine.ms > 2000 ? 'warn' : 'ok') : 'down', detail: engine.ok ? `${engine.ms} ms` : engine.error },
    {
      key: 'whatsappTraffic',
      level: !health ? 'down' : !newestTraffic ? 'warn' : now - newestTraffic.getTime() > 24 * HOUR ? 'warn' : 'ok',
      detail: newestTraffic ? t('admin.health.lastSeen', { time: formatKinshasa(newestTraffic) }) : t('admin.health.noTraffic'),
    },
    {
      key: 'jobs',
      level: !health ? 'down' : health.failures.failedJobs > 0 ? 'warn' : 'ok',
      detail: health ? t('admin.health.failedJobs', { count: health.failures.failedJobs }) : '—',
    },
    {
      key: 'sends',
      level: !health ? 'down' : health.failures.failedPushes24h > 0 ? 'warn' : 'ok',
      detail: health ? t('admin.health.failedSends', { count: health.failures.failedPushes24h }) : '—',
    },
    {
      key: 'delivery',
      level: !health ? 'down' : health.config.opsNumberConfigured ? 'ok' : 'warn',
      detail: health ? (health.config.opsNumberConfigured ? t('admin.telemetry.configured') : t('admin.health.opsMissing')) : '—',
    },
    {
      key: 'exchangeRate',
      level: !rate.ok ? 'down' : !rate.value ? 'warn' : now - new Date(rate.value).getTime() > 72 * HOUR ? 'warn' : 'ok',
      detail: rate.ok && rate.value ? t('admin.health.lastSeen', { time: formatKinshasa(rate.value) }) : '—',
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.health.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.health.subtitle')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {checks.map((check) => (
          <div key={check.key} className="u-card flex items-start gap-3 rounded-card bg-surface p-4">
            <StatusIcon level={check.level} />
            <div className="min-w-0">
              <div className="u-micro-strong text-ink">{t(`admin.health.check.${check.key}`)}</div>
              <div className="u-micro break-words text-ink-70">{check.detail}</div>
            </div>
          </div>
        ))}
      </div>

      {health?.alerts ? (
        <section className="flex flex-col gap-2">
          <div>
            <h2 className="u-title-card text-ink">{t('admin.health.alertsTitle')}</h2>
            <p className="u-micro text-ink-45">
              {health.config.opsNumberConfigured ? t('admin.health.alertsHintSent') : t('admin.health.alertsHintConsole')}
            </p>
          </div>
          {health.alerts.open.length === 0 ? (
            <div className="u-card flex items-center gap-3 rounded-card bg-surface p-4">
              <StatusIcon level="ok" />
              <span className="u-micro text-ink-70">{t('admin.health.noOpenAlerts')}</span>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {health.alerts.open.map((alert) => (
                <li key={alert.id} className="u-card flex items-start gap-3 rounded-card bg-surface p-4">
                  <StatusIcon level={alert.severity === 'critical' ? 'down' : 'warn'} />
                  <div className="min-w-0">
                    <div className="u-micro-strong break-words text-ink">{alert.message}</div>
                    <div className="u-micro text-ink-45">
                      {t('admin.health.alertOpened', { time: formatKinshasa(alert.opened_at) })}
                      {' · '}
                      {alert.notified_at
                        ? t('admin.health.alertNotified', { time: formatKinshasa(alert.notified_at) })
                        : alert.notify_error
                          ? t('admin.health.alertNotifyFailed', { error: alert.notify_error })
                          : t('admin.health.alertNotSent')}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {health.alerts.recent.length > 0 ? (
            <details className="u-card rounded-card bg-surface p-4">
              <summary className="u-micro-strong cursor-pointer text-ink">{t('admin.health.recentAlerts', { count: health.alerts.recent.length })}</summary>
              <ul className="mt-2 flex flex-col divide-y divide-line">
                {health.alerts.recent.map((alert) => (
                  <li key={alert.id} className="u-micro py-2 text-ink-70">
                    <div className="break-words text-ink">{alert.message}</div>
                    <div className="text-ink-45">
                      {t('admin.health.alertWindow', { opened: formatKinshasa(alert.opened_at), resolved: formatKinshasa(alert.resolved_at) })}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      {health ? (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="u-title-card text-ink">{t('admin.health.jobsTitle')}</h2>
            <TableFrame minWidth="48rem">
              <thead>
                <tr>
                  <th className={TH_STICKY}>{t('admin.health.colJob')}</th>
                  <th className={TH_STICKY}>{t('admin.health.colLastRun')}</th>
                  <th className={TH_STICKY}>{t('admin.health.colLastSuccess')}</th>
                  <th className={TH_STICKY}>{t('admin.health.colRuns')}</th>
                  <th className={TH_STICKY}>{t('admin.health.colError')}</th>
                </tr>
              </thead>
              <tbody>
                {health.jobs.length === 0 ? (
                  <tr><td colSpan={5} className="u-micro px-4 py-6 text-center text-ink-45">{t('admin.health.noJobs')}</td></tr>
                ) : health.jobs.map((job) => (
                  <tr key={job.name} className={TR_DENSE}>
                    <td className={`${TD_DENSE} font-semibold text-ink`}>{job.name}</td>
                    <td className={`${TD_DENSE} whitespace-nowrap`}>{formatKinshasa(job.last_run_at)}</td>
                    <td className={`${TD_DENSE} whitespace-nowrap`}>{formatKinshasa(job.succeeded_at)}</td>
                    <td className={`${TD_DENSE} u-tabular`}>{job.run_count}</td>
                    <td className={`${TD_DENSE} max-w-[20rem] break-words text-danger`}>{job.last_error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          </section>

          <section className="grid gap-3 lg:grid-cols-3">
            <div className="u-card rounded-card bg-surface p-5">
              <h2 className="u-title-card text-ink">{t('admin.health.trafficTitle')}</h2>
              <dl className="u-micro mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-ink-70">
                <dt className="text-ink-45">{t('admin.health.lastListing')}</dt><dd>{formatKinshasa(health.traffic.lastListingAt)}</dd>
                <dt className="text-ink-45">{t('admin.health.lastInbound')}</dt><dd>{formatKinshasa(health.traffic.lastInboundMessageAt)}</dd>
                <dt className="text-ink-45">{t('admin.health.lastLead')}</dt><dd>{formatKinshasa(health.traffic.lastLeadAt)}</dd>
                <dt className="text-ink-45">{t('admin.health.lastViewing')}</dt><dd>{formatKinshasa(health.traffic.lastViewingRequestAt)}</dd>
                <dt className="text-ink-45">{t('admin.health.listings24h')}</dt><dd className="u-tabular">{health.traffic.listings24h}</dd>
                <dt className="text-ink-45">{t('admin.health.leads24h')}</dt><dd className="u-tabular">{health.traffic.leads24h}</dd>
              </dl>
            </div>
            <div className="u-card rounded-card bg-surface p-5">
              <h2 className="u-title-card text-ink">{t('admin.health.failuresTitle')}</h2>
              <dl className="u-micro mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-ink-70">
                <dt className="text-ink-45">{t('admin.health.failedPushes')}</dt><dd className="u-tabular">{health.failures.failedPushes24h}</dd>
                <dt className="text-ink-45">{t('admin.health.slaEscalations')}</dt><dd className="u-tabular">{health.failures.slaEscalations24h}</dd>
                <dt className="text-ink-45">{t('admin.health.failedJobsLabel')}</dt><dd className="u-tabular">{health.failures.failedJobs}</dd>
              </dl>
            </div>
            <div className="u-card rounded-card bg-surface p-5">
              <h2 className="u-title-card text-ink">{t('admin.health.engineTitle')}</h2>
              <dl className="u-micro mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-ink-70">
                <dt className="text-ink-45">{t('admin.health.uptime')}</dt><dd className="u-tabular">{Math.round(health.process.uptimeSeconds / 3600)} h</dd>
                <dt className="text-ink-45">{t('admin.health.memory')}</dt><dd className="u-tabular">{health.process.memoryMb} MB</dd>
                <dt className="text-ink-45">Node</dt><dd className="u-tabular">{health.process.node}</dd>
                <dt className="text-ink-45">{t('admin.health.database')}</dt>
                <dd className="u-tabular">{health.database.sizeBytes == null ? '—' : `${(health.database.sizeBytes / 1024 / 1024).toFixed(1)} MB`}</dd>
                <dt className="text-ink-45">{t('admin.telemetry.config.templateLeadMatch')}</dt>
                <dd>{health.config.templates.leadMatch ? t('admin.telemetry.configured') : t('admin.telemetry.notConfigured')}</dd>
                <dt className="text-ink-45">{t('admin.telemetry.config.templateViewing')}</dt>
                <dd>{health.config.templates.viewingRequest ? t('admin.telemetry.configured') : t('admin.telemetry.notConfigured')}</dd>
              </dl>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
