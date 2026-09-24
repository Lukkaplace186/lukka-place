import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import AgentPageHeader from '@/components/AgentPageHeader';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentProjects } from '@/lib/developments';
import { LOT_STATUSES, LOT_STATUS_LABEL_KEYS } from '@/lib/developmentRules';
import { availabilityLine } from '@/lib/projectView';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { setLotStatusAction, setUnitsAvailableAction } from './actions';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('agent.projects.title'), robots: { index: false, follow: false } };
}

/**
 * A developer's projects, and the two numbers they keep current: units left
 * per type, lot status. Enquiries about these projects land in Demandes like
 * any other request (the engine stamps the lead with this account).
 */
export default async function AgentProjectsPage({ searchParams }) {
  const t = await getT();
  const agentId = await getCurrentAgentId();
  if (!agentId) redirect('/compte/agent/connexion');
  const sp = await searchParams;
  const projects = await getAgentProjects(agentId).catch(() => []);

  return (
    <>
      <AgentPageHeader title={t('agent.projects.title')} />
      <div className="flex flex-col gap-4 px-3 py-4 sm:gap-6 sm:px-8 sm:py-7">
        {sp.saved === '1' ? <p className="rounded-lg bg-success-tint px-4 py-2 text-sm text-success" role="status">{t('agent.projects.saved')}</p> : null}
        {sp.error ? <p className="rounded-lg bg-danger-tint px-4 py-2 text-sm text-danger" role="alert">{t('agent.projects.error')}</p> : null}
        <p className="u-micro max-w-2xl text-ink-70">{t('agent.projects.intro')}</p>

        {projects.length === 0 ? (
          <div className="rounded-card border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-70">
            {t('agent.projects.empty')}{' '}
            <Link href="/promoteurs" className="font-semibold text-blue-deep hover:underline">{t('agent.projects.emptyLink')}</Link>
          </div>
        ) : projects.map((project) => (
          <section key={project.id} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="u-title-card text-ink">{project.name}</h2>
                <p className="u-micro text-ink-70">
                  {availabilityLine(project, t) || '—'}
                  {project.approve_status !== 1 ? ` · ${t('agent.projects.draft')}` : ''}
                </p>
              </div>
              {project.approve_status === 1 && project.status === 1 ? (
                <Link href={`/projets/${project.slug}`} target="_blank" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-deep hover:underline">
                  {t('agent.projects.viewPublic')}
                  <ExternalLink strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                </Link>
              ) : null}
            </div>

            {(project.unit_types || []).length ? (
              <ul className="flex flex-col divide-y divide-line">
                {project.unit_types.map((unit) => (
                  <li key={unit.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <span className="text-sm font-semibold text-ink">{unit.label}</span>
                    <form action={setUnitsAvailableAction.bind(null, unit.id)} className="flex items-center gap-2">
                      <label className="text-[0.8125rem] text-ink-70" htmlFor={`units-${unit.id}`}>{t('agent.projects.unitsLeft')}</label>
                      <input
                        id={`units-${unit.id}`}
                        name="units_available"
                        type="number"
                        min="0"
                        max={unit.units_total ?? undefined}
                        defaultValue={unit.units_available ?? ''}
                        className="h-10 w-20 rounded-lg border border-line px-2 text-sm"
                      />
                      {unit.units_total !== null ? <span className="text-[0.8125rem] text-ink-45">/ {unit.units_total}</span> : null}
                      <button type="submit" className="rounded-full bg-blue px-3 py-2 text-xs font-semibold text-white">{t('agent.projects.save')}</button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : null}

            {(project.lots || []).length ? (
              <ul className="flex flex-col divide-y divide-line">
                {project.lots.map((lot) => (
                  <li key={lot.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <span className="text-sm font-semibold text-ink">
                      {lot.label}{lot.share_percent !== null ? ` (${Number(lot.share_percent)}%)` : ''}
                    </span>
                    <form action={setLotStatusAction.bind(null, lot.id)} className="flex items-center gap-2">
                      <select name="status" defaultValue={lot.status} className="h-10 rounded-lg border border-line bg-surface px-2 text-sm" aria-label={t('agent.projects.lotStatus')}>
                        {LOT_STATUSES.map((s) => <option key={s} value={s}>{t(LOT_STATUS_LABEL_KEYS[s])}</option>)}
                      </select>
                      <button type="submit" className="rounded-full bg-blue px-3 py-2 text-xs font-semibold text-white">{t('agent.projects.save')}</button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-[0.75rem] text-ink-45">{t('agent.projects.teamEdits')}</p>
          </section>
        ))}
      </div>
    </>
  );
}
