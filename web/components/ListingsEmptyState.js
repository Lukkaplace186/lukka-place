'use client';

import Link from '@/components/LocaleLink';
import { SearchX } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { hrefWithoutKeys, hrefWithParam } from '@/lib/urlParams';
import { useT } from '@/lib/i18n/client';
import GuestRequestForm from './GuestRequestForm';
import { guestRequestPrefill } from '@/lib/guestRequestRules';

// Each entry takes the translator so the chip reads in the visitor's own
// language; `property_type` passes its value straight through because it is
// already a resolved label, not a key.
const RELAXABLE_LABEL = {
  beds_min: (t, v) => t('listings.filters.bedsChip', { count: v }),
  bath_min: (t, v) => t('listings.filters.bathChip', { count: v }),
  property_type: (t, v) => v,
};

/**
 * Empty results.
 *
 * Offers real escape routes rather than a dead end: communes that genuinely
 * have approved listings right now (getPopularCommunes in lib/listings.js),
 * so every suggestion here is guaranteed to return results. Falls back to a
 * plain link to all listings when even that is empty.
 *
 * `params` (the page's raw searchParams) drives the targeted relaxation
 * links below — real report that prompted this: "3 bed house in Ngaliema"
 * has three independent reasons it could return 0 (wrong commune, no
 * 3-bed match, no maison in that commune), so offering one relaxation per
 * active filter lets a visitor try each independently rather than only
 * the blunt "clear everything" reset.
 */
export default function ListingsEmptyState({ popularCommunes = [], params = {}, propertyTypeLabel, communes = [] }) {
  const t = useT();
  const commune = params.commune;
  const quartier = params.quartier;
  const relaxable = [
    params.beds_min
      ? { key: 'beds_min', label: t('listings.filters.removeFilter', { label: RELAXABLE_LABEL.beds_min(t, params.beds_min) }) }
      : null,
    params.bath_min
      ? { key: 'bath_min', label: t('listings.filters.removeFilter', { label: RELAXABLE_LABEL.bath_min(t, params.bath_min) }) }
      : null,
    // Budget is the filter most often set too tight in Kinshasa searches.
    params.price_min || params.price_max
      ? { key: ['price_min', 'price_max'], label: t('listings.empty.removePrice') }
      : null,
    params.property_type
      ? {
          key: 'property_type',
          label: t('listings.filters.removeFilter', {
            label: RELAXABLE_LABEL.property_type(t, propertyTypeLabel || params.property_type),
          }),
        }
      : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-xl rounded-lg border border-line bg-surface px-6 py-14 text-center">
      <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-canvas-alt text-ink-45">
        <SearchX strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
      </span>

      <h2 className="font-bold text-xl tracking-[-0.01em] text-ink">{t('listings.empty.title')}</h2>
      <p className="mx-auto mt-2 max-w-sm text-[0.875rem] leading-relaxed text-ink-45">
        {commune ? (
          // ['1','3','5'] km having all failed (getListings()'s radius ladder
          // in lib/listings.js already tried them all before landing here
          // with total still 0) is worth saying honestly — otherwise the
          // "Élargir à {commune}" link right below reads as the first thing
          // offered, when a 5km real-distance search already ran and found
          // nothing.
          ['1', '3', '5'].includes(params.radius) ? (
            t('listings.empty.noneWithin5km', { commune })
          ) : (
            t('listings.empty.noExactAt', { commune })
          )
        ) : (
          t('listings.empty.generic')
        )}
      </p>

      {/* The request form sits at the bottom, under the relaxations; on a
          phone that is several screens down, so say up front that it exists. */}
      {communes.length > 0 ? (
        <a href="#trouver-pour-moi" className="mt-3 inline-block text-sm font-semibold text-blue-deep hover:underline">
          {t('listings.guestRequest.jump')}
        </a>
      ) : null}

      {commune || relaxable.length > 0 ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {quartier && commune && params.radius !== 'commune' && params.radius !== 'citywide' ? (
            <Link
              href={hrefWithParam(params, 'radius', 'commune')}
              className="u-press inline-flex items-center rounded-full border border-blue bg-blue-tint px-3.5 py-1.5 text-[0.8125rem] font-medium text-blue-deep transition-colors hover:bg-blue hover:text-white"
            >
              {t('listings.empty.widenToCommune', { commune })}
            </Link>
          ) : null}
          {commune && params.radius !== 'citywide' ? (
            <Link
              href={hrefWithParam(params, 'radius', 'citywide')}
              className="u-press inline-flex items-center rounded-full border border-blue bg-blue-tint px-3.5 py-1.5 text-[0.8125rem] font-medium text-blue-deep transition-colors hover:bg-blue hover:text-white"
            >
              {t('listings.empty.widen')}
            </Link>
          ) : null}
          {commune ? (
            <Link
              href={`/listings?commune=${encodeURIComponent(commune)}`}
              className="u-press inline-flex items-center rounded-full border border-line bg-canvas px-3.5 py-1.5 text-[0.8125rem] font-medium text-ink-70 transition-colors hover:border-blue hover:text-blue-deep"
            >
              {t('listings.empty.allIn', { commune })}
            </Link>
          ) : null}
          {relaxable.map(({ key, label }) => (
            <Link
              key={String(key)}
              href={hrefWithoutKeys(params, key)}
              className="u-press inline-flex items-center rounded-full border border-line bg-canvas px-3.5 py-1.5 text-[0.8125rem] font-medium text-ink-70 transition-colors hover:border-blue hover:text-blue-deep"
            >
              {label}
            </Link>
          ))}
        </div>
      ) : null}

      {popularCommunes.length > 0 ? (
        <>
          {/* Nearest first, with the distance, when a commune was searched
              (app/(site)/listings/(search)/(results)/page.js communesByDistance) — "the closest
              places that do have something" rather than the busiest ones
              across town. */}
          <p className="u-eyebrow mt-8 mb-3">
            {popularCommunes.some((c) => c.km != null)
              ? t('listings.empty.nearestCommunes')
              : t('listings.empty.communesWithListings')}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {popularCommunes.map(({ commune, count, km }) => (
              <Link
                key={commune}
                href={`/listings?commune=${encodeURIComponent(commune)}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas px-3.5 py-1.5 text-[0.8125rem] font-medium text-ink-70 transition-colors hover:border-blue hover:text-blue-deep"
              >
                {commune}
                <span className="u-tabular text-ink-25">{km != null ? `${km} km · ${count}` : count}</span>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/listings"
          className="inline-flex items-center rounded-full bg-blue px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
        >
          {t('listings.empty.seeAll')}
        </Link>
      </div>

      {/* The request without an account (lib/guestRequestRules.js). This
          used to be a "Trouver pour moi" link to /compte/client/demandes,
          which sends a guest to sign in first — a wall for exactly the
          visitor whose search just found nothing. Prefilled from that search. */}
      {communes.length > 0 ? (
        <section id="trouver-pour-moi" className="mx-auto mt-10 max-w-sm border-t border-line pt-8">
          <h3 className="u-title-card text-ink">{t('listings.guestRequest.title')}</h3>
          <p className="mt-1 mb-5 text-sm text-ink-45">{t('listings.guestRequest.lead')}</p>
          <GuestRequestForm communes={communes} prefill={guestRequestPrefill(params, communes)} />
        </section>
      ) : (
        // Outside Kinshasa the form has no commune list to offer: the signed-in
        // request form, which takes any city's communes, as before.
        <div className="mt-3 flex justify-center">
          <Link
            href="/compte/client/demandes"
            className="inline-flex items-center rounded-full border border-line bg-surface px-6 py-2.5 text-sm font-semibold text-ink-70 transition-colors hover:border-blue hover:text-blue-deep"
          >
            {t('listings.empty.findForMe')}
          </Link>
        </div>
      )}
    </div>
  );
}
