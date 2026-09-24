import Link from 'next/link';
import { Building2, HardHat, LandPlot, List, Map as MapIcon, ShieldCheck } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import ProjectCard from '@/components/projects/ProjectCard';
import ProjectsMapPane from '@/components/projects/ProjectsMapPane';
import { getProjectCommunes, getPublicProjects, projectCover, projectPosition } from '@/lib/developments';
import { PROJECT_FILTERS, projectPinLabel } from '@/lib/developmentRules';
import { availabilityLine } from '@/lib/projectView';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { cn } from '@/lib/utils';

export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('projects.meta.title'),
    description: t('projects.meta.description'),
    alternates: { canonical: '/projets' },
  };
}

const FILTER_LABEL_KEYS = {
  all: 'projects.filters.all',
  off_plan: 'projects.filters.offPlan',
  under_construction: 'projects.filters.underConstruction',
  delivered: 'projects.filters.delivered',
  land: 'projects.filters.land',
};

function hubHref({ filter, commune, view }) {
  const params = new URLSearchParams();
  if (filter && filter !== 'all') params.set('type', filter);
  if (commune) params.set('commune', commune);
  if (view === 'map') params.set('view', 'map');
  const query = params.toString();
  return `/projets${query ? `?${query}` : ''}`;
}

/**
 * /projets — new developments, buildings marketed by unit type, and land sold
 * in lots. Its own list and its own map (components/projects/ProjectsMap.js),
 * deliberately separate from /listings so the listings map stays readable.
 *
 * URL-driven like /listings: ?type= (one chip), ?commune= (only communes that
 * have a project are offered), ?view=map on a phone.
 */
export default async function ProjectsHubPage({ searchParams }) {
  const t = await getT();
  const sp = await searchParams;
  const filter = PROJECT_FILTERS.includes(sp.type) ? sp.type : 'all';
  const commune = typeof sp.commune === 'string' && sp.commune ? sp.commune : null;
  const view = sp.view === 'map' ? 'map' : 'list';

  const [projects, communes] = await Promise.all([
    getPublicProjects({ filter, commune }),
    getProjectCommunes(),
  ]);

  const pins = projects
    .map((project) => {
      const position = projectPosition(project);
      if (!position) return null;
      const label = projectPinLabel(project);
      const cover = projectCover(project);
      return {
        id: project.id,
        slug: project.slug,
        name: project.name,
        verified: Boolean(project.verified_at),
        label: t(label.key, label.vars),
        subtitle: availabilityLine(project, t),
        cover: cover?.src || null,
        coverIsRender: Boolean(cover?.isRender),
        ...position,
      };
    })
    .filter(Boolean);

  return (
    <div className="pb-16">
      <section className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
          <Breadcrumb
            className="hidden sm:flex"
            items={[{ label: t('breadcrumb.home'), href: '/' }, { label: t('projects.hub.crumb') }]}
          />
          <p className="u-eyebrow text-blue-deep">{t('projects.hub.eyebrow')}</p>
          <h1 className="u-title-hero max-w-3xl text-ink">{t('projects.hub.title')}</h1>
          <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-ink-70">{t('projects.hub.subtitle')}</p>
          <ul className="mt-2 grid gap-3 text-[0.8125rem] text-ink-70 sm:grid-cols-3">
            <li className="flex items-start gap-2">
              <HardHat strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-blue-deep" />
              {t('projects.hub.promiseTimeline')}
            </li>
            <li className="flex items-start gap-2">
              <ShieldCheck strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-blue-deep" />
              {t('projects.hub.promiseVerified')}
            </li>
            <li className="flex items-start gap-2">
              <LandPlot strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-blue-deep" />
              {t('projects.hub.promiseLots')}
            </li>
          </ul>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3">
          <nav aria-label={t('projects.filters.label')} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {PROJECT_FILTERS.map((key) => (
              <Link
                key={key}
                href={hubHref({ filter: key, commune, view })}
                aria-current={key === filter ? 'page' : undefined}
                className={cn(
                  'u-press inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-colors',
                  key === filter ? 'bg-ink text-white' : 'bg-surface text-ink-70 shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-ink',
                )}
              >
                {t(FILTER_LABEL_KEYS[key])}
              </Link>
            ))}
          </nav>

          {communes.length > 1 ? (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
              <Link
                href={hubHref({ filter, commune: null, view })}
                className={cn('u-tag shrink-0', !commune && 'bg-blue-tint text-blue-deep')}
              >
                {t('projects.filters.allCommunes')}
              </Link>
              {communes.map((row) => (
                <Link
                  key={row.commune}
                  href={hubHref({ filter, commune: row.commune, view })}
                  className={cn('u-tag shrink-0', commune === row.commune && 'bg-blue-tint text-blue-deep')}
                >
                  {row.commune} <span className="text-ink-45">{row.count}</span>
                </Link>
              ))}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-sm text-ink-70">{t('projects.hub.count', { count: projects.length })}</p>
            {projects.length > 0 ? (
              <Link
                href={hubHref({ filter, commune, view: view === 'map' ? 'list' : 'map' })}
                className="u-press inline-flex min-h-11 items-center gap-2 rounded-full bg-surface px-4 text-sm font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-line)] lg:hidden"
              >
                {view === 'map'
                  ? <><List strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />{t('projects.hub.showList')}</>
                  : <><MapIcon strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />{t('projects.hub.showMap')}</>}
              </Link>
            ) : null}
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-card border border-dashed border-line bg-surface px-6 py-14 text-center">
            <Building2 strokeWidth={1.5} className="h-10 w-10 text-ink-35" />
            <h2 className="u-title-section text-ink">{t('projects.hub.emptyTitle')}</h2>
            <p className="max-w-md text-sm text-ink-70">{t('projects.hub.emptyBody')}</p>
            <Link href="/promoteurs" className="u-btn-primary mt-2 inline-flex min-h-11 items-center rounded-full bg-blue px-5 text-sm font-semibold text-white">
              {t('projects.hub.developerCta')}
            </Link>
          </div>
        ) : (
          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-start">
            <div className={cn('grid gap-5 sm:grid-cols-2', view === 'map' && 'hidden lg:grid')}>
              {projects.map((project) => <ProjectCard key={project.id} project={project} />)}
            </div>
            <div className={cn('lg:sticky lg:top-24', view === 'map' ? 'block' : 'hidden lg:block')}>
              <ProjectsMapPane pins={pins} />
              {pins.length < projects.length ? (
                <p className="mt-2 text-[0.75rem] text-ink-45">
                  {t('projects.map.unplaced', { count: projects.length - pins.length })}
                </p>
              ) : null}
            </div>
          </div>
        )}

        <aside className="mt-12 flex flex-col items-start gap-3 rounded-card bg-ink px-6 py-8 text-white sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex flex-col gap-1">
            <p className="u-eyebrow text-white/60">{t('projects.hub.developerEyebrow')}</p>
            <p className="u-title-section text-white">{t('projects.hub.developerTitle')}</p>
            <p className="max-w-xl text-sm text-white/75">{t('projects.hub.developerBody')}</p>
          </div>
          <Link href="/promoteurs" className="u-press inline-flex min-h-11 shrink-0 items-center rounded-full bg-white px-5 text-sm font-semibold text-ink">
            {t('projects.hub.developerCta')}
          </Link>
        </aside>
      </div>
    </div>
  );
}
