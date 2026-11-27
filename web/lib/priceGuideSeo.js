/**
 * The price guide (/combien-coute) as something search engines and AI
 * assistants can cite, and the links that lead people to it (2026-11-21,
 * marketing plan: the guide is Lukka Place's unique asset — every commune ×
 * bedrooms median — but only the homepage linked to it, it showed no date and
 * carried no structured data). Pure: no database, no dictionary, safe in a
 * test and in the browser.
 *
 * Every value here comes from a published guide row (lib/browseFeatures.js
 * getPriceGuides): nothing is averaged, filled in or dated "today".
 */

/**
 * The newest data date behind a set of guides, 'YYYY-MM-DD' (Kinshasa
 * calendar), or null when no guide carries one. A guide's `updatedOn` is the
 * most recent moment one of its adverts was recorded: a Lukka Place listing
 * going public, or an advert seen elsewhere last confirmed online by the
 * nightly collection (lib/marketGuide.js, `seen_at`).
 */
export function guidesUpdatedOn(guides) {
  let newest = null;
  for (const guide of guides || []) {
    const day = isDay(guide?.updatedOn) ? guide.updatedOn : null;
    if (day && (!newest || day > newest)) newest = day;
  }
  return newest;
}

function isDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * "21 novembre 2026" / "21 November 2026" for a 'YYYY-MM-DD' day, or null.
 * Read as a calendar day (UTC midnight, formatted in UTC), so the server and
 * every phone print the same date.
 */
export function formatGuideDay(day, locale = 'fr') {
  if (!isDay(day)) return null;
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/** The published guides of one commune, fewest bedrooms first. */
export function guidesForCommune(guides, commune) {
  if (!commune) return [];
  return (guides || []).filter((guide) => guide.commune === commune).sort((a, b) => a.beds - b.beds);
}

/**
 * The guide a listing page links to: same commune and bedroom count, for a
 * long-term rental only (the guide is monthly asking rents — a sale, a day or
 * week rate is a different market). Null when no guide exists for that pair.
 */
export function guideForListing(guides, listing) {
  if (!listing || listing.purpose !== 'rent' || !listing.commune) return null;
  const period = String(listing.price_period || '').trim();
  if (period === 'jour' || period === 'semaine') return null;
  const beds = Number.parseInt(listing.beds, 10);
  if (!Number.isFinite(beds) || beds < 1) return null;
  return (guides || []).find((guide) => guide.commune === listing.commune && guide.beds === beds) || null;
}

/**
 * The saved search a guide page's alert creates: the guide's own search
 * (lib/homeMarket.js guideSearchHref — long-term rentals in the commune with
 * at least that many bedrooms), plus `ville` for a commune outside Kinshasa,
 * where /listings would otherwise search Kinshasa. A query string without
 * the leading "?". The existing alert sweep sends NEW LISTINGS matching it —
 * not a price report — and the button's copy says so.
 */
export function guideAlertQuery({ commune, beds, city = null }) {
  if (!commune || !(beds >= 1)) return null;
  const params = new URLSearchParams();
  params.set('transaction_type', 'location');
  if (city && city !== 'Kinshasa') params.set('ville', city);
  params.set('commune', commune);
  params.set('beds_min', String(beds));
  params.set('lease_term', 'long');
  return params.toString();
}

const ORGANIZATION = (base) => ({ '@id': `${base}/#organization`, '@type': 'Organization', name: 'Lukka Place' });

/**
 * schema.org Dataset for one guide page — only what the page itself shows:
 * the question as the name, the answer and the range as the description,
 * the method text, the place, the date of the newest data, and the two
 * measured values (the median rent and how many listings it rests on).
 * No `distribution`: there is no file to download, and a DataDownload
 * pointing at the HTML page would be a false claim.
 */
export function priceGuideDatasetJsonLd({ base, path, name, description, method, guide, place, city, updatedOn }) {
  const url = `${base}${path}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    '@id': `${url}#dataset`,
    name,
    description,
    url,
    inLanguage: 'fr',
    isAccessibleForFree: true,
    creator: ORGANIZATION(base),
    publisher: ORGANIZATION(base),
    ...(isDay(updatedOn) ? { dateModified: updatedOn } : {}),
    ...(method ? { measurementTechnique: method } : {}),
    spatialCoverage: {
      '@type': 'Place',
      name: `${place}, ${city || 'Kinshasa'}`,
      address: { '@type': 'PostalAddress', addressLocality: place, addressRegion: city || 'Kinshasa', addressCountry: 'CD' },
    },
    variableMeasured: [
      {
        '@type': 'PropertyValue',
        name: 'Loyer mensuel médian demandé',
        unitText: 'USD par mois',
        value: guide.median,
        ...(guide.p25 != null && guide.p75 != null ? { minValue: guide.p25, maxValue: guide.p75, description: 'Valeurs minimale et maximale : la moitié centrale des annonces (25e–75e centile).' } : {}),
      },
      { '@type': 'PropertyValue', name: "Nombre d'annonces comparées", value: guide.listings },
    ],
  };
}

/**
 * schema.org Dataset for the index page: every published commune × bedrooms
 * median, the cities they cover, the newest data date, and each guide page
 * as a part (`guides` are `{ name, description, slug }`, the question and
 * answer each card links to).
 */
export function priceGuideIndexJsonLd({ base, path, name, description, method, guides, cities, updatedOn }) {
  const url = `${base}${path}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    '@id': `${url}#dataset`,
    name,
    description,
    url,
    inLanguage: 'fr',
    isAccessibleForFree: true,
    creator: ORGANIZATION(base),
    publisher: ORGANIZATION(base),
    ...(isDay(updatedOn) ? { dateModified: updatedOn } : {}),
    ...(method ? { measurementTechnique: method } : {}),
    spatialCoverage: (cities && cities.length ? cities : ['Kinshasa']).map((city) => ({
      '@type': 'Place',
      name: `${city}, République démocratique du Congo`,
      address: { '@type': 'PostalAddress', addressLocality: city, addressCountry: 'CD' },
    })),
    variableMeasured: { '@type': 'PropertyValue', name: 'Loyer mensuel médian demandé', unitText: 'USD par mois' },
    hasPart: (guides || []).map((guide) => ({
      '@type': 'Dataset',
      name: guide.name,
      ...(guide.description ? { description: guide.description } : {}),
      url: `${base}/combien-coute/${guide.slug}`,
    })),
  };
}
