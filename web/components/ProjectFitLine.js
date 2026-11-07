import Link from 'next/link';
import { Check, Truck, X } from 'lucide-react';
import { getCurrentCustomerId } from '@/lib/customers';
import { listMoveProjects } from '@/lib/moveProjects';
import { projectDisplayName, projectFit } from '@/lib/moveProjectRules';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

/**
 * "Pour votre projet" on a listing page (2026-11-07): for a signed-in
 * customer with a still-searching move project, how this home fits it —
 * bedrooms, commune, budget — from fields both sides state (projectFit).
 * The project that fits best is shown; nothing for a visitor, a customer
 * without a project, or a home of the wrong kind. Streamed under Suspense,
 * so it never delays the page; any failure renders nothing.
 */
export default async function ProjectFitLine({ listing }) {
  let customerId = null;
  let projects = [];
  try {
    customerId = await getCurrentCustomerId();
    if (!customerId) return null;
    projects = (await listMoveProjects(customerId)).filter((p) => p.status === 'active');
  } catch {
    return null;
  }
  let best = null;
  projects.forEach((project, index) => {
    const fit = projectFit(listing, project);
    if (fit && (!best || fit.score > best.fit.score)) best = { project, index, fit };
  });
  if (!best) return null;

  const t = await getT();
  const name = projectDisplayName(best.project, {
    reasonLabel: (r) => t(`account.move.steps.reasons.options.${r}`),
    fallback: t('account.move.list.untitled', { n: best.index + 1 }),
  });
  return (
    <div className="mt-3 rounded-xl bg-blue-tint px-3.5 py-3">
      <Link href={`/compte/client/projet/${best.project.id}`} className="flex items-center gap-1.5 text-[0.8125rem] font-bold text-blue-deep hover:underline">
        <Truck strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 flex-none" aria-hidden="true" />
        {t('account.move.fit.for', { name })}
      </Link>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {best.fit.checks.map((check) => (
          <li key={check.kind} className={`flex items-center gap-1 text-[0.8125rem] ${check.ok ? 'text-green-deep' : 'text-amber-800'}`}>
            {check.ok
              ? <Check strokeWidth={2.5} className="h-3.5 w-3.5" aria-hidden="true" />
              : <X strokeWidth={2.5} className="h-3.5 w-3.5" aria-hidden="true" />}
            {t(`account.move.fit.${check.kind}${check.kind === 'bedrooms' || check.kind === 'commune' ? (check.ok ? 'Ok' : 'No') : ''}`, check.vars || {})}
          </li>
        ))}
      </ul>
    </div>
  );
}
