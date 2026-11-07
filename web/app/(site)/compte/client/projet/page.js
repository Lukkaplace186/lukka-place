import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarClock, ChevronRight, MapPin, Pencil, Plus, Truck } from 'lucide-react';
import { getPortalCustomer } from '@/lib/customerPortal';
import { listMoveProjects } from '@/lib/moveProjects';
import { getMoveMatches } from '@/lib/moveMatches';
import { MAX_MOVE_PROJECTS } from '@/lib/moveProjectRules';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { storyLines } from './storyLines';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('account.move.page.metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

const CARD = 'rounded-card bg-surface shadow-[var(--hairline),var(--shadow-card)]';

/** How many homes match one project right now — exact only; the project page shows the close ones. */
async function MatchCount({ project, t }) {
  let total = null;
  try {
    total = (await getMoveMatches(project, { exactLimit: 1, withClose: false }))?.total ?? null;
  } catch (err) {
    console.warn(`[move-project] count failed for project #${project.id}: ${err.message}`);
  }
  if (total == null) return null;
  return (
    <span className={total ? 'font-bold text-green-deep' : 'text-ink-45'}>
      {total ? t('account.move.matches.count', { count: total }) : t('account.move.list.noneYet')}
    </span>
  );
}

/**
 * "Mes projets" (2026-11-07): every move the customer is planning — up to
 * MAX_MOVE_PROJECTS — each with its story, how many homes match it, and
 * links to see and edit it; "Nouveau projet" while there is room. The tab
 * "Projets" opens here, so a project is always one tap from being edited.
 */
export default async function MoveProjectsPage({ searchParams }) {
  const params = await searchParams;
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client/projet');
  const t = await getT();
  const projects = await listMoveProjects(session.customerId);
  const room = projects.length < MAX_MOVE_PROJECTS;

  return (
    <div className="mx-auto flex max-w-[45rem] flex-col gap-4 sm:gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="u-eyebrow text-blue">{t('account.move.eyebrow')}</p>
          <h1 className="u-title-page mt-1 text-ink">{t('account.move.list.title')}</h1>
          {projects.length ? (
            <p className="mt-1 text-[0.8125rem] text-ink-45">{t('account.move.list.count', { count: projects.length, max: MAX_MOVE_PROJECTS })}</p>
          ) : null}
        </div>
        {room && projects.length ? (
          <Link
            href="/compte/client/projet/nouveau"
            className="u-btn-primary inline-flex min-h-11 items-center gap-1.5 rounded-md bg-blue px-4 text-sm font-bold text-white hover:bg-blue-deep"
          >
            <Plus strokeWidth={2.5} className="h-4 w-4" aria-hidden="true" />
            {t('account.move.list.new')}
          </Link>
        ) : null}
      </div>

      {params?.limite === '1' || (!room && projects.length) ? (
        <p className="rounded-xl bg-canvas-deep px-4 py-3 text-sm text-ink-70" role={params?.limite === '1' ? 'alert' : undefined}>
          {t('account.move.list.limit', { max: MAX_MOVE_PROJECTS })}
        </p>
      ) : null}

      {projects.length === 0 ? (
        <section className={`flex flex-col gap-3 p-5 ${CARD}`}>
          <h2 className="u-title-section text-ink">{t('account.move.page.empty.title')}</h2>
          <p className="text-[0.9375rem] text-ink-45">{t('account.move.page.empty.lead')}</p>
          <Link href="/compte/client/projet/nouveau" className="u-btn-primary inline-flex min-h-12 items-center justify-center rounded-md bg-blue px-4 text-[0.9375rem] font-bold text-white hover:bg-blue-deep">
            {t('account.move.page.empty.cta')}
          </Link>
        </section>
      ) : (
        <ul className="flex flex-col gap-3">
          {projects.map((project, index) => {
            const { name, reasonLabels, toLine, whenLine } = storyLines(project, t, index);
            return (
              <li key={project.id} className={`flex flex-col gap-2 p-4 ${CARD}`}>
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-blue-tint text-blue">
                    <Truck strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="u-title-card text-ink">{name}</h2>
                    {reasonLabels.length && project.title ? (
                      <p className="truncate text-[0.8125rem] text-ink-45">{reasonLabels.join(' · ')}</p>
                    ) : null}
                  </div>
                </div>
                {toLine ? (
                  <p className="flex items-start gap-2 text-[0.875rem] text-ink">
                    <MapPin strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 flex-none text-blue" aria-hidden="true" />
                    {toLine}
                  </p>
                ) : null}
                {whenLine ? (
                  <p className="flex items-start gap-2 text-[0.875rem] text-ink-70">
                    <CalendarClock strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 flex-none text-ink-45" aria-hidden="true" />
                    {whenLine}
                  </p>
                ) : null}
                <p className="text-[0.8125rem]">
                  <Suspense fallback={<span className="text-ink-45">{t('account.move.matches.loading')}</span>}>
                    <MatchCount project={project} t={t} />
                  </Suspense>
                </p>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <Link
                    href={`/compte/client/projet/${project.id}`}
                    className="u-press inline-flex min-h-11 items-center justify-center gap-1 rounded-md bg-blue px-3 text-sm font-bold text-white hover:bg-blue-deep"
                  >
                    {t('account.move.list.open')}
                    <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <Link
                    href={`/compte/client/projet/${project.id}/modifier`}
                    className="u-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-bold text-ink hover:border-blue"
                  >
                    <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                    {t('account.move.list.edit')}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
