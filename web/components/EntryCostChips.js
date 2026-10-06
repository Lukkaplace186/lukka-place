import { cn } from '@/lib/utils';

/**
 * "Garantie 3 mois · Avance 1 mois · Commission 1 mois" — the three entry
 * costs as separate chips, each only when the listing states it
 * (lib/clientPortalView.js entryCostParts). Never a summed "Garantie".
 *
 * No hooks, so a Server Component or a client one can render it; the caller
 * passes its own translator.
 */
export default function EntryCostChips({ parts, t, className = '' }) {
  if (!parts?.length) return null;
  return (
    <ul className={cn('flex flex-wrap gap-1.5', className)} aria-label={t('account.entry.label')}>
      {parts.map(({ key, months }) => (
        <li key={key} className="u-tabular inline-flex h-6 items-center rounded-full bg-canvas-deep px-2.5 text-[0.75rem] font-semibold text-ink-70">
          {t(`account.entry.${key}`, { count: months })}
        </li>
      ))}
    </ul>
  );
}
