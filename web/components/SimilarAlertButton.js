import { BellRing } from 'lucide-react';
import QueryAlertButton from './QueryAlertButton';
import { getT } from '@/lib/i18n/server';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * "Pas tout à fait ça ?" — the listing page's alert for listings like this
 * one (same rent / sale, commune, type, bedrooms, price ±30 %:
 * lib/similarSearch.js similarAlertQuery). The listing page is where a
 * visitor's intent is clearest, and the only ask it made was "Enregistrer".
 * Renders nothing when the listing states too little to search on.
 *
 * `variant="card"` sits beside the contact card; `"inline"` under the
 * "Biens similaires" rail.
 */
export default async function SimilarAlertButton({ query, variant = 'card' }) {
  if (!query) return null;
  const t = await getT();

  if (variant === 'inline') {
    return (
      <div className="mt-2 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[0.9375rem] text-ink-70">{t('listings.similarAlert.inlineLead')}</p>
        <QueryAlertButton query={query} label={t('listings.similarAlert.button')} />
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-tint text-blue-deep">
          <BellRing strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[1rem] font-semibold leading-snug text-ink">{t('listings.similarAlert.title')}</h2>
          <p className="mt-1 text-[0.875rem] leading-relaxed text-ink-70">{t('listings.similarAlert.lead')}</p>
        </div>
      </div>
      <QueryAlertButton query={query} label={t('listings.similarAlert.button')} fullWidth className="mt-4" />
    </section>
  );
}
