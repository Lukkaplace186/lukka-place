import Link from 'next/link';
import { BadgeCheck, Building2, LandPlot, MapPin } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import Price from '@/components/Price';
import { getT } from '@/lib/i18n/server';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { projectHref } from '@/lib/developmentRules';
import { projectCover } from '@/lib/developments';
import {
  availabilityLine, bedroomsRange, fromPrice, projectKindLabel, projectLocationLine, stageLabel,
} from '@/lib/projectView';

/**
 * One project on /projets and on a developer's profile. Everything on it is
 * read off the row: the cover says when it is a render, the availability
 * line is omitted when no unit type states one, and "Vérifié" appears only on
 * a real verified_at.
 */
export default async function ProjectCard({ project }) {
  const t = await getT();
  const cover = projectCover(project);
  const price = fromPrice(project);
  const availability = availabilityLine(project, t);
  const beds = project.kind === 'building' ? bedroomsRange(project.unit_summary, t) : null;
  const where = projectLocationLine(project);
  const Icon = project.kind === 'land' ? LandPlot : Building2;
  const stage = project.kind === 'building' ? stageLabel(project, t) : null;

  return (
    <Link
      href={projectHref(project)}
      className="u-card u-card-interactive group flex flex-col overflow-hidden rounded-card bg-surface"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-canvas-alt">
        {cover ? (
          <SafeImage
            src={cover.src}
            alt={project.name}
            fill
            sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-ink-35">
            <Icon strokeWidth={1.5} className="h-12 w-12" />
          </div>
        )}
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-ink/85 px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-white">
            {projectKindLabel(project, t)}
          </span>
          {project.verified_at ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success px-2.5 py-1 text-[0.6875rem] font-semibold text-white">
              <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
              {t('projects.badge.verified')}
            </span>
          ) : null}
        </div>
        {cover?.isRender ? (
          <span className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-0.5 text-[0.6875rem] font-medium text-white">
            {t('projects.render')}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        {price ? (
          <p className="u-tabular text-[1.125rem] font-bold text-ink">
            <span className="mr-1 text-[0.8125rem] font-medium text-ink-45">{t('projects.card.from')}</span>
            <Price amount={price.amount} purpose={price.purpose} pricePeriod={price.period} />
          </p>
        ) : (
          <p className="text-[0.9375rem] font-semibold text-ink-70">{t('projects.card.priceOnRequest')}</p>
        )}
        <h3 className="u-title-card text-ink">{project.name}</h3>
        {where ? (
          <p className="inline-flex items-center gap-1.5 text-[0.8125rem] text-ink-70">
            <MapPin strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 shrink-0" />
            {where}
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[0.8125rem] text-ink-70">
          {stage ? <span className="font-semibold text-blue-deep">{stage}</span> : null}
          {beds ? <span>{beds}</span> : null}
          {availability ? <span>{availability}</span> : null}
        </div>
        {project.agency_name ? (
          <p className="border-t border-line pt-2 text-[0.75rem] text-ink-45">
            {t('projects.card.by', { name: project.agency_name })}
          </p>
        ) : project.developer_name ? (
          <p className="border-t border-line pt-2 text-[0.75rem] text-ink-45">
            {t('projects.card.by', { name: project.developer_name })}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
