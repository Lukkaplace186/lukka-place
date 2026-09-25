import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Check } from 'lucide-react';
import AgentPageHeader from '@/components/AgentPageHeader';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentProject } from '@/lib/developments';
import { WIZARD_STEPS, projectReviewState, wizardProgress } from '@/lib/developmentRules';
import { shortDate } from '@/lib/projectView';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import StepEtat from './_steps/StepEtat';
import StepLieu from './_steps/StepLieu';
import StepMedias from './_steps/StepMedias';
import StepOffreBuilding from './_steps/StepOffreBuilding';
import StepOffreLand from './_steps/StepOffreLand';
import StepPaiement from './_steps/StepPaiement';
import StepApercu from './_steps/StepApercu';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('agent.projects.wizard.editTitle'), robots: { index: false, follow: false } };
}

const STATE_TONE = {
  draft: 'bg-canvas-alt text-ink-70',
  submitted: 'bg-blue-tint text-blue-deep',
  changes: 'bg-warning-tint text-ink',
  live: 'bg-success-tint text-success',
  live_edited: 'bg-success-tint text-success',
};

/**
 * The developer wizard: one screen per step (`?step=`), each saved to the
 * server as the developer goes, so a draft is finished later on any device.
 * The stepper's ticks come from the row (wizardProgress), never from where
 * the developer has clicked.
 */
export default async function EditAgentProjectPage({ params, searchParams }) {
  const t = await getT();
  const agentId = await getCurrentAgentId();
  if (!agentId) redirect('/compte/agent/connexion');
  const { id } = await params;
  const sp = await searchParams;
  const project = await getAgentProject(agentId, id);
  if (!project) notFound();

  const step = WIZARD_STEPS.includes(sp.step) ? sp.step : 'etat';
  const progress = wizardProgress(project);
  const state = projectReviewState(project);
  const errorKey = typeof sp.error === 'string' ? sp.error : null;
  const errorText = errorKey
    ? (t.has(`agent.projects.wizard.errors.${errorKey}`) ? t(`agent.projects.wizard.errors.${errorKey}`)
      : t.has(`admin.projects.errors.${errorKey}`) ? t(`admin.projects.errors.${errorKey}`)
        : t('agent.projects.wizard.errors.generic'))
    : null;
  const savedKey = typeof sp.saved === 'string' ? `agent.projects.wizard.saved.${sp.saved}` : null;
  const savedText = savedKey && t.has(savedKey)
    ? t(savedKey, { count: Number(sp.count) || 0, skipped: Number(sp.skipped) || 0 })
    : null;
  const stepIndex = WIZARD_STEPS.indexOf(step);

  return (
    <>
      <AgentPageHeader title={project.name} subtitle={t('agent.projects.wizard.editTitle')} />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-3 py-4 sm:px-8 sm:py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/compte/agent/projets" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-70 hover:text-ink">
            <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('agent.projects.wizard.backToList')}
          </Link>
          <span className={`rounded-full px-3 py-1 text-[0.75rem] font-semibold ${STATE_TONE[state]}`}>
            {t(`agent.projects.wizard.state.${state}`)}
          </span>
        </div>

        {state === 'changes' && project.review_note ? (
          <div className="rounded-card border border-warning/40 bg-warning-tint p-4 text-sm" role="status">
            <p className="font-semibold text-ink">{t('agent.projects.wizard.changesIntro', { date: shortDate(project.reviewed_at, t.locale) })}</p>
            <p className="mt-1 whitespace-pre-line text-ink">{project.review_note}</p>
          </div>
        ) : null}

        {/* Stepper: a scrollable row of chips on a phone, the same row on desktop. */}
        <nav aria-label={t('agent.projects.wizard.stepsLabel')} className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
          <ol className="flex min-w-max gap-2">
            {WIZARD_STEPS.map((key, index) => {
              const current = key === step;
              const done = progress[key];
              return (
                <li key={key}>
                  <Link
                    href={`/compte/agent/projets/${project.id}/modifier?step=${key}`}
                    aria-current={current ? 'step' : undefined}
                    className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-[0.8125rem] font-semibold ${
                      current ? 'border-blue bg-blue text-white' : done ? 'border-success/40 bg-success-tint text-success' : 'border-line bg-surface text-ink-70'
                    }`}
                  >
                    {done && !current ? <Check strokeWidth={2.5} className="h-3.5 w-3.5" /> : <span className="text-[0.75rem] opacity-70">{index + 1}</span>}
                    {t(`agent.projects.wizard.steps.${key}`)}
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        {errorText ? <p className="rounded-lg bg-danger-tint px-4 py-2 text-sm font-semibold text-danger" role="alert">{errorText}</p> : null}
        {savedText ? <p className="rounded-lg bg-success-tint px-4 py-2 text-sm text-success" role="status">{savedText}</p> : null}

        {step === 'etat' ? <StepEtat project={project} t={t} /> : null}
        {step === 'lieu' ? <StepLieu project={project} t={t} /> : null}
        {step === 'medias' ? <StepMedias project={project} t={t} /> : null}
        {step === 'offre' ? (project.kind === 'land' ? <StepOffreLand project={project} t={t} /> : <StepOffreBuilding project={project} t={t} />) : null}
        {step === 'paiement' ? <StepPaiement project={project} t={t} /> : null}
        {step === 'apercu' ? <StepApercu project={project} t={t} /> : null}

        {/* Steps without their own "continue" (the offer, the images) get a plain next link. */}
        {step === 'offre' || step === 'medias' ? (
          <div className="flex justify-end">
            <Link
              href={`/compte/agent/projets/${project.id}/modifier?step=${WIZARD_STEPS[stepIndex + 1]}`}
              className="u-btn-primary inline-flex min-h-11 items-center rounded-full bg-blue px-5 text-sm font-semibold text-white"
            >
              {t('agent.projects.wizard.next')}
            </Link>
          </div>
        ) : null}
      </div>
    </>
  );
}
