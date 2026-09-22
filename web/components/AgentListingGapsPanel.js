import Link from 'next/link';
import { Camera } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { gapLabelKey, listingGapHref } from '@/lib/completenessRules';
import { getT } from '@/lib/i18n/server';

const TERM_KEYS = { monthly: 'agent.completeness.termMonthly', yearly: 'agent.completeness.termYearly', lifetime: 'agent.completeness.termOnce' };

/**
 * "Annonces à compléter" above the Mes biens table: each listing that still
 * has a gap, with one chip per gap linking straight to that field in the
 * editor. A panel of its own rather than chips inside AgentListingsTable's
 * row grid, which is shared and tuned to one markup for phone and desktop.
 *
 * When any of them is short of photos, the paid photography package is
 * offered — its title and price read live from `packages`
 * (lib/completeness.js getPhotographyOffer), linked to its card on the
 * Abonnement page, where the existing plan-request flow handles it. No
 * package, no offer.
 */
export default async function AgentListingGapsPanel({ listings = [], photographyOffer = null }) {
  const t = await getT();
  if (listings.length === 0) return null;
  const hasThin = listings.some((l) => l.gaps.includes('thin_photos'));

  return (
    <section id="a-completer" className="u-card flex scroll-mt-24 flex-col gap-3 rounded-card bg-surface p-4 sm:p-6">
      <div>
        <h2 className="u-title-card text-ink">{t('agent.completeness.listingsTitle', { count: listings.length })}</h2>
        <p className="u-micro mt-0.5 text-ink-45">{t('agent.completeness.listingsHint')}</p>
      </div>

      <ul className="flex flex-col divide-y divide-line">
        {listings.map((listing) => (
          <li key={listing.id} className="flex flex-col gap-2 py-2.5">
            <Link
              href={`/compte/agent/biens/${listing.id}/edit`}
              className="u-micro-strong truncate text-ink hover:text-blue-deep"
            >
              {listing.title || `#${listing.id}`}
            </Link>
            <div className="flex flex-wrap gap-1.5">
              {listing.gaps.map((code) => (
                <Link
                  key={code}
                  href={listingGapHref(listing.id, code)}
                  className="u-press inline-flex min-h-10 items-center rounded-full bg-warning-tint px-3 text-xs font-semibold text-warning hover:brightness-95"
                  title={t('agent.completeness.fix')}
                >
                  {t(gapLabelKey(code))}
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {hasThin && photographyOffer && (
        <div className="flex flex-col gap-2.5 rounded-lg bg-blue-tint p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <Camera strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-blue-deep" aria-hidden="true" />
            <p className="u-micro text-ink">
              {t('agent.completeness.photoOffer', {
                title: photographyOffer.title,
                price:
                  photographyOffer.price == null
                    ? '—'
                    : `${photographyOffer.price.toLocaleString('fr-FR')} $${
                        TERM_KEYS[photographyOffer.term] ? ` ${t(TERM_KEYS[photographyOffer.term])}` : ''
                      }`,
              })}
            </p>
          </div>
          <Link
            href={`/compte/agent/abonnement#plan-${photographyOffer.id}`}
            className="u-btn-primary u-press inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-blue px-4 text-[0.8125rem] font-bold text-white"
          >
            {t('agent.completeness.photoOfferCta')}
          </Link>
        </div>
      )}
    </section>
  );
}
