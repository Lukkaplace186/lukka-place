import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ExternalLink, Pencil, Plus } from 'lucide-react';
import AgentPageHeader from '@/components/AgentPageHeader';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentProjects } from '@/lib/developments';
import { LOT_STATUSES, LOT_STATUS_LABEL_KEYS, projectReviewState, publishBlockers } from '@/lib/developmentRules';
import { availabilityLine } from '@/lib/projectView';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { setLotStatusAction, setUnitsAvailableAction } from './actions';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('agent.projects.title'), robots: { index: false, follow: false } };
}

const STATE_TONE = {
  draft: 'bg-canvas-alt text-ink-70',
  submitted: 'bg-blue-tint text-blue-deep',
  changes: 'bg-warning-tint text-ink',
  live: 'bg-success-tint text-success',
  live_edited: 'bg-success-tint text-success',
};

/**
 * A developer's projects: where each stands (draft / waiting for the team /
 * changes asked / public), a way back into the wizard, and the two numbers
 * kept current from here — units left on a type WITHOUT individual units
 * (a type with units is counted from its listings), and each lot's status.
 */
export default async function AgentProjectsPage({ searchParams }) {
  const t = await getT();
  const agentId = await getCurrentAgentId();
  if (!agentId) redirect('/compte/agent/connexion');
  const sp = await searchParams;
  const projects = await getAgentProjects(agentId).catch(() => []);

  const newButton = (
    <Link href="/compte/agent/projets/nouveau" className="u-btn-primary inline-flex min-h-10 items-center gap-1.5 rounded-full bg-blue px-3 text-sm font-semibold text-white sm:px-4">
      <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
      <span className="max-sm:sr-only">{t('agent.projects.wizard.newTitle')}</span>
    </Link>
  );

  return (
    <>
      <AgentPageHeader title={t('agent.projects.title')} action={newButton} />
      <div className="flex flex-col gap-4 px-3 py-4 sm:gap-6 sm:px-8 sm:py-7">
        {sp.saved === '1' ? <p className="rounded-lg bg-success-tint px-4 py-2 text-sm text-success" role="status">{t('agent.projects.saved')}</p> : null}
        {sp.saved === 'deleted' ? <p className="rounded-lg bg-success-tint px-4 py-2 text-sm text-success" role="status">{t('agent.projects.wizard.saved.deleted')}</p> : null}
        {sp.error ? <p className="rounded-lg bg-danger-tint px-4 py-2 text-sm text-danger" role="alert">{t('agent.projects.error')}</p> : null}
        <p className="u-micro max-w-2xl text-ink-70">{t('agent.projects.intro')}</p>

        {projects.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-70">
            <p className="u-title-section text-ink">{t('agent.projects.wizard.emptyTitle')}</p>
            <p className="max-w-md">{t('agent.projects.wizard.emptyBody')}</p>
            <Link href="/compte/agent/projets/nouveau" className="u-btn-primary inline-flex min-h-11 items-center rounded-full bg-blue px-5 text-sm font-semibold text-white">
              {t('agent.projects.wizard.newTitle')}
            </Link>
            <Link href="/promoteurs" className="font-semibold text-blue-deep hover:underline">{t('agent.projects.emptyLink')}</Link>
          </div>
        ) : projects.map((project) => {
          const state = projectReviewState(project);
          const live = state === 'live' || state === 'live_edited';
          const blockers = publishBlockers(project);
          const back = '/compte/agent/projets?saved=1';
          return (
            <section key={project.id} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="u-title-card text-ink">{project.name}</h2>
                    <span className={`rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold ${STATE_TONE[state]}`}>{t(`agent.projects.wizard.state.${state}`)}</span>
                  </div>
                  <p className="u-micro text-ink-70">
                    {availabilityLine(project, t) || (state === 'draft' && blockers.length ? t('agent.projects.wizard.toFinish', { count: blockers.length }) : '—')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Link href={`/compte/agent/projets/${project.id}/modifier?step=${state === 'draft' ? 'etat' : 'apercu'}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line px-3 text-sm font-semibold text-ink">
                    <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                    {state === 'draft' ? t('agent.projects.wizard.continue') : t('agent.projects.wizard.edit')}
                  </Link>
                  {live ? (
                    <Link href={`/projets/${project.slug}`} target="_blank" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-deep hover:underline">
                      {t('agent.projects.viewPublic')}
                      <ExternalLink strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                    </Link>
                  ) : null}
                </div>
              </div>

              {state === 'changes' && project.review_note ? (
                <p className="rounded-lg bg-warning-tint px-3 py-2 text-[0.8125rem] text-ink">{project.review_note}</p>
              ) : null}

              {live && (project.unit_types || []).length ? (
                <ul className="flex flex-col divide-y divide-line">
                  {project.unit_types.map((unit) => (
                    <li key={unit.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                      <span className="text-sm font-semibold text-ink">{unit.label}</span>
                      {unit.counted ? (
                        <span className="text-[0.8125rem] text-ink-70">
                          {t('agent.projects.wizard.units.availableShort', { count: unit.units_available })} · {t('agent.projects.wizard.units.counted')}
                        </span>
                      ) : (
                        <form action={setUnitsAvailableAction.bind(null, unit.id)} className="flex items-center gap-2">
                          <input type="hidden" name="back" value={back} />
                          <label className="text-[0.8125rem] text-ink-70" htmlFor={`units-${unit.id}`}>{t('agent.projects.unitsLeft')}</label>
                          <input id={`units-${unit.id}`} name="units_available" type="number" min="0" max={unit.units_total ?? undefined} defaultValue={unit.units_available ?? ''} className="h-10 w-20 rounded-lg border border-line px-2 text-sm" />
                          {unit.units_total !== null ? <span className="text-[0.8125rem] text-ink-45">/ {unit.units_total}</span> : null}
                          <button type="submit" className="rounded-full bg-blue px-3 py-2 text-xs font-semibold text-white">{t('agent.projects.save')}</button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}

              {live && (project.lots || []).length ? (
                <ul className="flex flex-col divide-y divide-line">
                  {project.lots.map((lot) => (
                    <li key={lot.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                      <span className="text-sm font-semibold text-ink">
                        {lot.label}{lot.share_percent !== null && !String(lot.label).includes('%') ? ` (${Number(lot.share_percent)}%)` : ''}
                      </span>
                      <form action={setLotStatusAction.bind(null, lot.id)} className="flex items-center gap-2">
                        <input type="hidden" name="back" value={back} />
                        <select name="status" defaultValue={lot.status} className="h-10 rounded-lg border border-line bg-surface px-2 text-sm" aria-label={t('agent.projects.lotStatus')}>
                          {LOT_STATUSES.map((s) => <option key={s} value={s}>{t(LOT_STATUS_LABEL_KEYS[s])}</option>)}
                        </select>
                        <button type="submit" className="rounded-full bg-blue px-3 py-2 text-xs font-semibold text-white">{t('agent.projects.save')}</button>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : null}

              {live && project.kind === 'building' && project.stage !== 'delivered' ? (
                <Link href={`/compte/agent/projets/${project.id}/modifier?step=apercu#chantier`} className="self-start text-sm font-semibold text-blue-deep hover:underline">
                  {t('agent.projects.wizard.addUpdate')}
                </Link>
              ) : null}
            </section>
          );
        })}
      </div>
    </>
  );
}
