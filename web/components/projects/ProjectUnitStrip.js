import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { getPublicProjectById } from '@/lib/developments';
import { unitListingState } from '@/lib/developmentRules';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

/**
 * On a unit's listing page: "Fait partie de Résidence Lumière · 6 unités
 * disponibles → Voir le projet", and the building's other available units.
 * Only for a PUBLIC project (getPublicProjectById applies the gate); a unit
 * whose project was taken down shows nothing here. Renders nothing on error —
 * the listing page must never fail because of its project.
 */
export default async function ProjectUnitStrip({ developmentId, listingId }) {
  const project = await getPublicProjectById(developmentId).catch(() => null);
  if (!project) return null;
  const t = await getT();
  const others = (project.unit_types || [])
    .flatMap((type) => (type.live_units || []).map((u) => ({ ...u, typeLabel: type.label })))
    .filter((u) => String(u.id) !== String(listingId) && unitListingState(u) === 'available')
    .slice(0, 8);
  const available = project.unit_summary?.available ?? null;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Building2 strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-5 w-5 shrink-0 text-blue-deep" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm text-ink">
            {t('projects.unitStrip.partOf')} <span className="font-semibold">{project.name}</span>
            {available ? <span className="text-ink-70"> · {t('projects.unitStrip.available', { count: available })}</span> : null}
          </p>
          <Link href={`/projets/${project.slug}`} className="text-sm font-semibold text-blue-deep hover:underline">
            {t('projects.unitStrip.seeProject')}
          </Link>
        </div>
      </div>
      {others.length ? (
        <ul className="flex flex-wrap gap-2">
          {others.map((u) => (
            <li key={u.id}>
              <Link href={`/listings/${u.id}`} className="inline-flex min-h-9 items-center rounded-full bg-canvas-alt px-3 text-[0.8125rem] font-semibold text-ink hover:bg-blue-tint">
                {u.unit_label} · {u.typeLabel}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
