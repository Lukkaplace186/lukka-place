import Link from 'next/link';
import { CheckCircle2, Circle, ExternalLink, Eye } from 'lucide-react';
import ConstructionUpdateForm from '@/components/projects/wizard/ConstructionUpdateForm';
import { publishBlockers, projectReviewState, wizardProgress } from '@/lib/developmentRules';
import { dayLabel } from '@/lib/projectView';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { addConstructionUpdateAction, deleteDraftAction, submitProjectAction } from '../../../actions';
import { INPUT, PRIMARY, SECONDARY, Section } from './ui';

function kinshasaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa' }).format(new Date());
}

/**
 * Step 6 — look at it as a buyer will, then hand it to the team. Once public,
 * this is where the developer keeps it alive: construction photos (dated),
 * with the public link at hand.
 */
export default function StepApercu({ project, t }) {
  const blockers = publishBlockers(project);
  const progress = wizardProgress(project);
  const state = projectReviewState(project);
  const live = state === 'live' || state === 'live_edited';
  const checklist = [
    { key: 'etat', done: progress.etat },
    { key: 'lieu', done: progress.lieu },
    { key: 'medias', done: progress.medias },
    { key: 'offre', done: progress.offre },
    { key: 'paiement', done: progress.paiement, optional: true },
  ];
  const offPlan = project.kind === 'building' && project.stage !== 'delivered';

  return (
    <div className="flex flex-col gap-4">
      <Section title={t('agent.projects.wizard.apercu.checkTitle')}>
        <ul className="flex flex-col gap-2">
          {checklist.map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                {item.done
                  ? <CheckCircle2 strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 text-success" />
                  : <Circle strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 text-ink-25" />}
                <span className={item.done ? 'text-ink' : 'text-ink-70'}>
                  {t(`agent.projects.wizard.steps.${item.key}`)}
                  {item.optional ? <span className="ml-1 text-ink-45">({t('agent.projects.wizard.optional')})</span> : null}
                </span>
              </span>
              {!item.done ? (
                <Link href={`/compte/agent/projets/${project.id}/modifier?step=${item.key}`} className="text-[0.8125rem] font-semibold text-blue-deep hover:underline">
                  {t('agent.projects.wizard.complete')}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
        <Link href={`/projets/apercu/${project.id}`} target="_blank" className={`${SECONDARY} gap-2 self-start`}>
          <Eye strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('agent.projects.wizard.apercu.preview')}
        </Link>
      </Section>

      {live ? (
        <Section title={t('agent.projects.wizard.apercu.liveTitle')} intro={t(state === 'live_edited' ? 'agent.projects.wizard.apercu.liveEdited' : 'agent.projects.wizard.apercu.liveIntro')}>
          <Link href={`/projets/${project.slug}`} target="_blank" className={`${PRIMARY} gap-2 self-start`}>
            {t('agent.projects.viewPublic')}
            <ExternalLink strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          </Link>
        </Section>
      ) : state === 'submitted' ? (
        <Section title={t('agent.projects.wizard.apercu.submittedTitle')} intro={t('agent.projects.wizard.apercu.submittedIntro')}>
          <p className="text-sm text-ink-70">{t('agent.projects.wizard.apercu.submittedEdit')}</p>
        </Section>
      ) : (
        <Section title={t('agent.projects.wizard.apercu.submitTitle')} intro={t('agent.projects.wizard.apercu.submitIntro')}>
          {blockers.length ? (
            <ul className="list-disc pl-5 text-sm text-ink-70">
              {blockers.map((b) => <li key={b}>{t(`admin.projects.errors.publish_${b}`)}</li>)}
            </ul>
          ) : null}
          <form action={submitProjectAction.bind(null, project.id)}>
            <button type="submit" disabled={blockers.length > 0} className={`${PRIMARY} min-h-12 disabled:opacity-40`}>
              {state === 'changes' ? t('agent.projects.wizard.apercu.resubmit') : t('agent.projects.wizard.apercu.submit')}
            </button>
          </form>
        </Section>
      )}

      {offPlan ? (
        <Section id="chantier" title={t('agent.projects.wizard.apercu.updatesTitle')} intro={t('agent.projects.wizard.apercu.updatesIntro')}>
          {(project.updates || []).length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {project.updates.slice(0, 5).map((u) => (
                <li key={u.id} className="text-ink-70">
                  <span className="font-semibold text-ink">{dayLabel(u.taken_on, t.locale)}</span>
                  {u.caption ? ` — ${u.caption}` : ''}
                  <span className="text-ink-45"> · {t('admin.projects.timeline.photos', { count: (u.photos || []).length })}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <ConstructionUpdateForm
            action={addConstructionUpdateAction.bind(null, project.id)}
            today={kinshasaToday()}
            labels={{
              date: t('admin.projects.timeline.date'),
              caption: t('admin.projects.timeline.caption'),
              captionExample: t('admin.projects.timeline.captionExample'),
              submit: t('admin.projects.timeline.add'),
              done: t('agent.projects.wizard.apercu.updateDone'),
              failed: t('agent.projects.wizard.uploadFailed'),
              offline: t('agent.projects.wizard.upload.offline'),
              tooLarge: t('agent.projects.wizard.upload.tooLarge'),
            }}
          />
        </Section>
      ) : null}

      {!live ? (
        <details className="rounded-card border border-line bg-surface p-4">
          <summary className="cursor-pointer text-sm font-semibold text-danger">{t('agent.projects.wizard.apercu.deleteTitle')}</summary>
          <form action={deleteDraftAction.bind(null, project.id)} className="mt-3 flex flex-wrap items-center gap-3">
            <p className="w-full text-[0.8125rem] text-ink-70">{t('agent.projects.wizard.apercu.deleteIntro')}</p>
            <input name="confirm" required placeholder="SUPPRIMER" aria-label={t('agent.projects.wizard.apercu.deleteConfirm')} className={`${INPUT} w-40`} />
            <button type="submit" className="min-h-11 rounded-full bg-danger px-4 text-sm font-semibold text-white">{t('agent.projects.wizard.apercu.deleteButton')}</button>
          </form>
        </details>
      ) : null}
    </div>
  );
}
