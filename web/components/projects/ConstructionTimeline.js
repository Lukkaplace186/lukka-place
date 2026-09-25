import SafeImage from '@/components/SafeImage';
import { AlertTriangle } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { STALE_UPDATE_DAYS, timelineIsStale } from '@/lib/developmentRules';
import { dayLabel } from '@/lib/projectView';

/**
 * Dated construction progress — the date is the day the photos show, entered
 * by a person, not when the row was typed in. An off-plan project whose last
 * update is older than STALE_UPDATE_DAYS says so in plain words: a timeline
 * that stops is information a buyer is owed.
 */
export default async function ConstructionTimeline({ project }) {
  const t = await getT();
  const updates = project.updates || [];
  if (project.kind !== 'building' || project.stage === 'delivered') {
    if (!updates.length) return null;
  }
  const stale = timelineIsStale(project, updates);

  return (
    <section className="flex flex-col gap-3" id="chantier">
      <h2 className="u-title-section text-ink">{t('projects.timeline.title')}</h2>
      {stale ? (
        <p className="flex items-start gap-2 rounded-lg bg-warning-tint px-3.5 py-2.5 text-sm text-ink" role="note">
          <AlertTriangle strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          {t('projects.timeline.stale', { days: STALE_UPDATE_DAYS })}
        </p>
      ) : null}
      {updates.length === 0 ? (
        <p className="rounded-card border border-dashed border-line bg-surface px-4 py-6 text-sm text-ink-70">
          {t('projects.timeline.none')}
        </p>
      ) : (
        <ol className="relative flex flex-col gap-6 border-l-2 border-line pl-5">
          {updates.map((update) => (
            <li key={update.id} className="relative flex flex-col gap-2">
              <span className="absolute -left-[1.6rem] top-1 h-3 w-3 rounded-full border-2 border-surface bg-blue" aria-hidden="true" />
              <p className="u-micro-strong text-ink">{dayLabel(update.taken_on, t.locale)}</p>
              {update.caption ? <p className="text-sm text-ink-70">{update.caption}</p> : null}
              {update.photos?.length ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {update.photos.map((src) => (
                    <div key={src} className="relative h-28 w-40 shrink-0 overflow-hidden rounded-lg bg-canvas-alt">
                      <SafeImage src={src} alt={update.caption || project.name} fill sizes="160px" className="object-cover" />
                    </div>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
