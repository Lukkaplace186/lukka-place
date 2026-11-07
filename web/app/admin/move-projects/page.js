import Link from 'next/link';
import { getMoveProjectStats } from '@/lib/moveProjectStats';
import { communeLabel } from '@/lib/cities';
import { getT } from '@/lib/i18n/server';
import { ErrorNote, Stat, formatKinshasa } from '../LeadRoutingUI';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('admin.moveProjects.title') };
}

const TH = 'px-3 py-2 text-left u-micro-strong text-ink-45';
const TD = 'px-3 py-2 u-micro text-ink';

function pct(part, whole) {
  return whole ? `${Math.round((part / whole) * 100)} %` : '—';
}

/**
 * "Mon déménagement" in aggregate (2026-11-07, lib/moveProjectStats.js): how
 * many moves customers told us, where they stand, why people move and where
 * to, and the north star — moves we followed to the end. Stories appear only
 * when their customer agreed to share them. Card-by-card drop-off of the
 * signup flow is in the web log, not here (web/CLAUDE.md, "[onboarding]").
 */
export default async function AdminMoveProjectsPage() {
  const t = await getT();
  let stats = null;
  let failed = false;
  try {
    stats = await getMoveProjectStats();
  } catch (err) {
    console.error(`[admin/move-projects] ${err.message}`);
    failed = true;
  }
  const reasonLabel = (r) => (r === 'autre' ? t('admin.moveProjects.otherReason') : t(`account.move.steps.reasons.options.${r}`));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.moveProjects.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.moveProjects.subtitle')}</p>
      </div>

      {failed ? <ErrorNote>{t('admin.moveProjects.loadError')}</ErrorNote> : null}
      {!failed && !stats ? <p className="u-micro text-ink-45">{t('admin.moveProjects.noTable')}</p> : null}

      {stats ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t('admin.moveProjects.northStar')} value={stats.found} hint={t('admin.moveProjects.northStarHint', { settled: stats.settled, rate: pct(stats.found, stats.projects) })} />
            <Stat label={t('admin.moveProjects.projects')} value={stats.projects} hint={t('admin.moveProjects.customers', { count: stats.customers })} />
            <Stat label={t('admin.moveProjects.searching')} value={stats.active} hint={t('admin.moveProjects.paused', { count: stats.paused })} />
            <Stat
              label={t('admin.moveProjects.medianDays')}
              value={stats.median_days_to_found == null ? '—' : t('admin.moveProjects.days', { count: stats.median_days_to_found })}
              hint={t('admin.moveProjects.sent', { count: stats.sent })}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="u-card overflow-hidden rounded-card bg-surface">
              <h2 className="u-title-card px-4 pt-4 text-ink">{t('admin.moveProjects.byReason')}</h2>
              <table className="mt-2 w-full">
                <thead><tr><th className={TH}>{t('admin.moveProjects.reason')}</th><th className={TH}>{t('admin.moveProjects.projects')}</th><th className={TH}>{t('admin.moveProjects.foundCol')}</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {stats.reasons.length ? stats.reasons.map((row) => (
                    <tr key={row.reason}><td className={TD}>{reasonLabel(row.reason)}</td><td className={`${TD} u-tabular`}>{row.projects}</td><td className={`${TD} u-tabular`}>{row.found} ({pct(row.found, row.projects)})</td></tr>
                  )) : <tr><td className={TD} colSpan={3}>{t('admin.moveProjects.none')}</td></tr>}
                </tbody>
              </table>
            </section>

            <section className="u-card overflow-hidden rounded-card bg-surface">
              <h2 className="u-title-card px-4 pt-4 text-ink">{t('admin.moveProjects.byCommune')}</h2>
              <table className="mt-2 w-full">
                <thead><tr><th className={TH}>{t('admin.moveProjects.commune')}</th><th className={TH}>{t('admin.moveProjects.projects')}</th><th className={TH}>{t('admin.moveProjects.foundCol')}</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {stats.communes.length ? stats.communes.map((row) => (
                    <tr key={row.commune}><td className={TD}>{communeLabel(row.commune)}</td><td className={`${TD} u-tabular`}>{row.projects}</td><td className={`${TD} u-tabular`}>{row.found}</td></tr>
                  )) : <tr><td className={TD} colSpan={3}>{t('admin.moveProjects.none')}</td></tr>}
                </tbody>
              </table>
            </section>
          </div>

          <section className="u-card overflow-hidden rounded-card bg-surface">
            <h2 className="u-title-card px-4 pt-4 text-ink">{t('admin.moveProjects.pairs')}</h2>
            <p className="u-micro px-4 text-ink-45">{t('admin.moveProjects.pairsHint')}</p>
            <ul className="flex flex-wrap gap-2 p-4">
              {stats.pairs.length ? stats.pairs.map((row) => (
                <li key={`${row.reason}-${row.commune}`} className="rounded-full bg-blue-tint px-3 py-1 u-micro text-blue-deep">
                  {reasonLabel(row.reason)} · {communeLabel(row.commune)} — <span className="u-tabular font-bold">{row.projects}</span>
                </li>
              )) : <li className="u-micro text-ink-45">{t('admin.moveProjects.none')}</li>}
            </ul>
          </section>

          <section className="u-card rounded-card bg-surface p-4">
            <h2 className="u-title-card text-ink">{t('admin.moveProjects.stories')} ({stats.stories})</h2>
            <p className="u-micro text-ink-45">{t('admin.moveProjects.storiesHint')}</p>
            {stats.stories.length ? (
              <ul className="mt-3 flex flex-col gap-3">
                {stats.stories.map((row) => (
                  <li key={`${row.customer_id}-${row.consent_at}`} className="border-l-2 border-green pl-3">
                    <p className="u-micro italic text-ink">« {row.story} »</p>
                    <p className="u-micro mt-0.5 text-ink-45">
                      {(row.reasons || []).map(reasonLabel).join(', ')}
                      {(row.communes || []).length ? ` · ${row.communes.map(communeLabel).join(', ')}` : ''}
                      {' · '}{t('admin.customers.moveStoryConsent', { date: formatKinshasa(row.consent_at) })}
                      {' · '}<Link href={`/admin/customers/${row.customer_id}`} className="text-blue-deep hover:underline">{t('admin.moveProjects.customer')}</Link>
                    </p>
                  </li>
                ))}
              </ul>
            ) : <p className="u-micro mt-2 text-ink-45">{t('admin.moveProjects.noStories')}</p>}
          </section>
        </>
      ) : null}
    </div>
  );
}
