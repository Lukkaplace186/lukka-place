'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n/client';
import { ChevronRight } from 'lucide-react';
import SortDropdown from './SortDropdown';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * Results header — breadcrumb, real result count and sort, following the
 * reference (Rightmove puts exactly this row above its results and it is
 * the clearest orientation device on the page).
 *
 * The heading is built from the filters actually applied, never a static or
 * invented location. SaveSearchButton now lives in FilterBar.js instead, at
 * the end of the toolbar to match Zoopla's own layout — it's `type="button"`
 * there so it still can't trigger the surrounding filter form's submit.
 */
/*
 * Assembled from a template rather than by concatenation, because the two
 * languages do not put these three parts in the same order or shape:
 * "Appartements à louer à Gombe" vs "Apartments to rent in Gombe". A
 * `${subject} ${label} à ${place}` concatenation hardcodes the French
 * preposition into the structure itself.
 */
function buildHeading({ t, commune, communes, quartier, transactionType, propertyTypeLabel, citywide, communeWide, mapArea, relaxation }) {
  const subject = propertyTypeLabel || t('listings.results.subjectFallback');
  // Place names are real data and are never translated. Several communes
  // ("Gombe ou Ngaliema") are all named — the search covers every one.
  const communePlace = Array.isArray(communes) && communes.length > 1 ? communes.join(', ') : commune;
  const place = citywide
    ? 'Kinshasa'
    : communeWide || relaxation?.quartierWidened
      ? communePlace
      : quartier || communePlace || 'Kinshasa';
  const transaction =
    transactionType === 'location'
      ? t('search.label.toRent')
      : transactionType === 'vente'
        ? t('search.label.toBuy')
        : t('search.label.available');
  // The map's visible area has no name: saying "à Bandalungwa" over results
  // the visitor panned away from would be claiming a place they left.
  if (mapArea) return t('listings.results.areaHeading', { subject, transaction });
  // Nearest alternatives are not "in" the place searched — they are near it.
  if (relaxation?.nearby) return t('listings.results.headingNear', { subject, transaction, place: communePlace || place });
  return t('listings.results.heading', { subject, transaction, place });
}

/**
 * What lib/listings.js relaxSearch changed to find these results, one line per
 * step, in the order it took them. Every step is said out loud: a visitor
 * shown Masina listings for a Kimbanseke search must know that is what
 * happened.
 */
function relaxationNotes(t, relaxation) {
  if (!relaxation) return [];
  const notes = [];
  if (relaxation.keywordsIgnored?.length) {
    notes.push(t('listings.results.relaxedKeywords', {
        count: relaxation.keywordsIgnored.length,
        words: relaxation.keywordsIgnored.join(' '),
      }));
  }
  if (relaxation.quartierWidened) {
    notes.push(t('listings.results.relaxedQuartier', relaxation.quartierWidened));
  }
  if (relaxation.nearby) {
    const origin = relaxation.nearby.origin.join(', ');
    const places = (relaxation.nearby.places || []).map(({ commune, km }) => `${commune} (${km} km)`).join(', ');
    notes.push(
      places
        ? t('listings.results.relaxedNearby', { origin, places })
        : t('listings.results.relaxedNearbyPlain', { origin }),
    );
  }
  if (relaxation.priceMax) {
    const locale = t.locale === 'en' ? 'en-GB' : 'fr-FR';
    const figure = relaxation.priceMax.to.toLocaleString(locale);
    notes.push(t('listings.results.relaxedPrice', { amount: t.locale === 'en' ? `$${figure}` : `${figure} $` }));
  }
  if (relaxation.beds) {
    notes.push(t('listings.results.relaxedBeds', relaxation.beds));
  }
  return notes;
}

export default function ResultsHeader({
  total,
  commune,
  communes = null,
  quartier,
  transactionType,
  propertyTypeLabel,
  locationRelaxed = false,
  relaxedFromCommune = null,
  // FilterBar.js's "Rayon" dropdown — commune/quartier are still selected
  // (the pill/breadcrumb should keep showing them as the search's starting
  // point) but the query itself no longer filters on one or both of them, so
  // the heading and result count must say so, not silently keep claiming
  // "à {quartier}" for a result set that's actually commune- or city-wide.
  citywide = false,
  communeWide = false,
  // Km-radius auto-expand ladder (getListings()'s RADIUS_LADDER, lib/
  // listings.js): fires only when the visitor explicitly picked a narrow km
  // tier on FilterBar.js's Rayon pill and it returned zero results.
  // requestedRadius keeps matching what the pill itself still shows
  // ("+1 km") — this caption is what makes the wider data honest instead of
  // silently mixing distances.
  radiusExpanded = false,
  requestedRadius = null,
  effectiveRadius = null,
  // The results are the map's visible area (lib/listings.js getListings).
  mapArea = false,
  clearAreaHref = null,
  // lib/listings.js relaxSearch: what was changed to find these results.
  relaxation = null,
}) {
  const t = useT();
  const heading = buildHeading({
    t,
    commune,
    communes,
    quartier,
    transactionType,
    propertyTypeLabel,
    citywide,
    communeWide,
    mapArea,
    relaxation,
  });
  const notes = relaxationNotes(t, relaxation);

  const crumbs = [
    { label: t('breadcrumb.home'), href: '/' },
    { label: t('breadcrumb.listings'), href: '/listings' },
  ];
  if (commune) crumbs.push({ label: commune, href: `/listings?commune=${encodeURIComponent(commune)}` });

  return (
    // mb-2, not the previous mb-5, below lg — "tight top block, first card
    // visible on initial load" instruction. lg:mb-5 keeps desktop as it
    // was, matching the breadcrumb's own lg: reveal breakpoint just below
    // so the two never fall out of step (a value that switched at a
    // different breakpoint than the nav it's spacing would leave a stretch
    // of viewport widths with the old margin but no breadcrumb to justify
    // it, or vice versa).
    <div className="mb-2 lg:mb-5">
      {/* hidden lg:flex — the breadcrumb is real navigation (Accueil >
          Annonces > commune), not decoration, but it's also the first
          thing eating vertical space above the feed on a phone, per an
          explicit "no breadcrumb on mobile" instruction. Desktop keeps it,
          unchanged. */}
      <nav aria-label={t('breadcrumb.ariaLabel')} className="mb-4 hidden flex-wrap items-center gap-1 text-[0.75rem] text-ink-45 lg:flex">
        {crumbs.map(({ label, href }, i) => (
          <span key={href} className="inline-flex items-center gap-1">
            {i > 0 ? (
              <ChevronRight strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-3 w-3 text-ink-25" />
            ) : null}
            {i === crumbs.length - 1 ? (
              <span className="text-ink-70">{label}</span>
            ) : (
              <Link href={href} className="transition-colors hover:text-blue-deep">
                {label}
              </Link>
            )}
          </span>
        ))}
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {/* Sans, not `font-display` (the DM Serif Display face) — a
              deliberate departure from this app's usual "serif only for
              editorial titles, never heavy" rule (web/CLAUDE.md), on an
              explicit "punchier, high-contrast like Zoopla/Zillow"
              instruction for this specific results-page title. font-black
              (900) isn't achievable: Plus Jakarta Sans is only loaded up to
              800 (app/layout.js's own `weight` list) and DM Serif Display
              has no bold cut at all — either would fake a weight the font
              doesn't have. font-extrabold (800) is the real heaviest
              available, same reasoning as PropertyCard's price.

              Mobile now steps back down to `text-lg font-bold` — Zoopla's
              own results-header title is genuinely smaller/lighter than
              the "punchier" treatment above asked for, per a direct
              follow-up instruction pointing at that exact reference
              screenshot. `lg:` (not `sm:`) is where it grows into the
              larger extrabold size, matching the breadcrumb/margin
              breakpoint just above so the whole block steps up together
              rather than piecemeal across different widths. */}
          <h1 className="text-xl font-medium leading-7 tracking-[0.1px] text-ink lg:text-2xl lg:leading-8">
            {heading}
          </h1>
          {/* text-sm/font-normal throughout, including the count itself —
              Zoopla's own count line is a plain muted caption, not a
              semibold number standing out against the rest of the line. */}
          {/* The count and its noun are one dictionary entry: English
              pluralises at a different boundary than French (0 is plural in
              English, singular in French), which a `{total !== 1 ? 's' : ''}`
              suffix cannot express. `.u-tabular` moves to the whole line —
              the number is no longer a separately wrapped span, since its
              position inside the sentence differs by language. */}
          <p className="u-tabular mt-1 text-sm font-normal text-ink-45">
            {t('listings.results.resultCount', { count: total })}
          </p>
          {mapArea ? (
            <p className="mt-1 text-[0.8125rem] text-ink-45">
              {t('listings.results.mapAreaNote')}
              {clearAreaHref ? (
                <>
                  {' · '}
                  <Link href={clearAreaHref} className="font-semibold text-blue-deep underline-offset-2 hover:underline">
                    {t('listings.results.clearArea')}
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          {notes.map((note) => (
            <p key={note} className="mt-1 text-[0.8125rem] text-ink-45">
              {note}
            </p>
          ))}
          {locationRelaxed ? (
            <p className="mt-1 text-[0.8125rem] text-ink-45">
              {t('listings.results.locationRelaxed', { commune: relaxedFromCommune })}
            </p>
          ) : null}
          {citywide && (commune || quartier) ? (
            <p className="mt-1 text-[0.8125rem] text-ink-45">
              {t('listings.results.citywideFrom', { place: quartier || commune })}
            </p>
          ) : communeWide && quartier ? (
            <p className="mt-1 text-[0.8125rem] text-ink-45">
              {t('listings.results.communeWideFrom', { commune, quartier })}
            </p>
          ) : radiusExpanded ? (
            <p className="mt-1 text-[0.8125rem] text-ink-45">
              {t('listings.results.radiusExpanded', { requested: requestedRadius, effective: effectiveRadius })}
            </p>
          ) : null}
        </div>

        {/* Desktop only. On a phone, sorting lives in FloatingControlBar's
            Carte | Trier | Alerte pill — this was its second copy, a whole
            row above the first card. */}
        <span className="hidden shrink-0 lg:inline-flex">
          <SortDropdown />
        </span>
      </div>
    </div>
  );
}
