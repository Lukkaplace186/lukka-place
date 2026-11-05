import { placeLabel } from '@/lib/placeLabel';
import { SITE_URL } from './constants';
import { formatPrice, usablePrice } from './format';
import { hasArea, listingImages, typeLabel } from './listingView';
import { seoPath } from './seoPages';
import { localizeHref } from './localePaths';
import { DEFAULT_CITY, cityOfCommune, cityOfListing, communeLabel, provinceOfCity } from './cities';

// UN/CEFACT codes for the rent's unit; a short-term rent is per day / week.
const SCHEMA_UNIT_CODES = { an: 'ANN', mois: 'MON', jour: 'DAY', semaine: 'WEE' };

/**
 * What a search result says about one listing — its <title>, meta
 * description and schema.org data — built from the listing's own structured
 * fields, not from the agent's free-text title. People search "appartement 2
 * chambres à louer Ngiri-Ngiri"; the stored title is whatever the agent typed.
 *
 * Pure (t is passed in) so tests/unit/seo-pages.test.js drives it with the
 * real dictionaries.
 */

const base = () => SITE_URL.replace(/\/+$/, '');
const DESCRIPTION_MAX = 160;

function purposeWord(listing, t) {
  if (listing.purpose === 'rent') return t('seo.forRent');
  if (listing.purpose === 'sale') return t('seo.forSale');
  return '';
}

function placeOf(listing, t) {
  // "Kampemba, Lubumbashi" outside Kinshasa, the commune alone inside it
  // (lib/placeLabel.js); a listing with no commune names its own city.
  if (listing.commune) return placeLabel({ commune: listing.commune });
  return listing.quartier || (listing.city_name && cityOfListing(listing) !== DEFAULT_CITY ? cityOfListing(listing) : t('seo.city'));
}

/**
 * English words for the category names, for the English <title> and meta
 * description only (/en pages): Google matches "2-bedroom apartment for rent",
 * not "Appartement". A taxonomy label, not the agent's text — the listing's
 * own title and description stay as written.
 */
const EN_KINDS = {
  appartement: 'apartment',
  maison: 'house',
  terrain: 'land',
  villa: 'villa',
  studio: 'studio',
  duplex: 'duplex',
  penthouse: 'penthouse',
  concession: 'compound',
  boutique: 'shop',
  bureau: 'office',
  'entrepôt': 'warehouse',
  immeuble: 'building',
  'bâtiment': 'building',
  'chambre / annexe': 'room',
  'ferme / terrain agricole': 'farm',
};
const EN_PERIODS = { an: '/ year', jour: '/ day', semaine: '/ week' };

function kindOf(listing, t) {
  const kind = typeLabel(listing, t);
  if (t?.locale !== 'en' || !kind || kind !== listing.category_name) return kind;
  // A parcelle sub-type is already a translated key; a category name is French data.
  return EN_KINDS[String(kind).toLowerCase()] || kind;
}

/** "450 $ / mois" in French, "$450 / month" in English. */
function priceOf(listing, t) {
  if (t?.locale !== 'en') return formatPrice(listing.price, listing.purpose, listing.price_period);
  const amount = usablePrice(listing.price);
  if (amount === null) return 'price on request';
  const money = `$${amount.toLocaleString('en-US')}`;
  return listing.purpose === 'rent' ? `${money} ${EN_PERIODS[listing.price_period] || '/ month'}` : money;
}

function capitalise(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function clip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:—-]+$/, '')}…`;
}

export function listingMetaTitle(listing, t) {
  const beds = Number(listing.beds) > 0 ? t('seo.listingBeds', { count: Number(listing.beds) }) : '';
  const kind = kindOf(listing, t) || t('seo.allTypes');
  const title = t('seo.listingTitle', {
    kind,
    beds,
    purpose: purposeWord(listing, t),
    place: placeOf(listing, t),
    price: priceOf(listing, t),
  });
  return capitalise(title.replace(/\s{2,}/g, ' ').trim());
}

export function listingMetaDescription(listing, t) {
  const facts = [];
  if (Number(listing.beds) > 0) facts.push(t('seo.factBeds', { count: Number(listing.beds) }));
  if (Number(listing.bath) > 0) facts.push(t('seo.factBath', { count: Number(listing.bath) }));
  if (hasArea(listing.area)) facts.push(t('seo.factArea', { n: Number(listing.area) }));
  if (listing.purpose === 'rent' && Number(listing.deposit_months) > 0) facts.push(t('seo.factDeposit', { n: Number(listing.deposit_months) }));
  const place = placeLabel(listing) || placeOf(listing, t);
  const head = capitalise(t('seo.listingDescription', {
    kind: kindOf(listing, t) || t('seo.allTypes'),
    purpose: purposeWord(listing, t),
    place,
    price: priceOf(listing, t),
    facts: facts.length ? `${facts.join(', ')}.` : '',
  }).replace(/\s{2,}/g, ' ').trim());
  const excerpt = typeof listing.description === 'string' ? listing.description.replace(/\s+/g, ' ').trim() : '';
  return clip(excerpt ? `${head} ${excerpt}` : head, DESCRIPTION_MAX);
}

function absolute(src) {
  try {
    return new URL(src, `${base()}/`).toString();
  } catch {
    return null;
  }
}

const SCHEMA_TYPES = { appartement: 'Apartment', maison: 'House', duplex: 'House', penthouse: 'Apartment', villa: 'House', concession: 'House', studio: 'Apartment' };

/** Where the listing's commune crumb points: its landing page when there is one. */
export function communeHref(listing) {
  if (!listing.commune) return null;
  const transaction = listing.purpose === 'sale' ? 'vente' : listing.purpose === 'rent' ? 'location' : null;
  // A commune of another city has no page of its own; its city's page is the
  // nearest landing page ("Kampemba" → /location/lubumbashi).
  const otherCity = cityOfCommune(listing.commune);
  return (transaction && (seoPath({ transaction, commune: listing.commune })
      || (otherCity && otherCity !== DEFAULT_CITY ? seoPath({ transaction, city: otherCity }) : null)))
    || `/listings?commune=${encodeURIComponent(listing.commune)}`;
}

/**
 * RealEstateListing + BreadcrumbList. No coordinates: the map shows a
 * deliberately blurred position, and structured data must not leak the exact
 * one. No agent phone either — that has its own verification rule on the page.
 */
export function listingJsonLd(listing, t) {
  // English pages point at English URLs (lib/localePaths.js); `t.locale` is the page's language.
  const loc = (path) => localizeHref(path, t?.locale);
  const url = `${base()}${loc(`/listings/${listing.id}`)}`;
  const images = listingImages(listing).map(absolute).filter(Boolean).slice(0, 8);
  const price = usablePrice(listing.price);
  const category = String(listing.parcelle_subtype === 'villa' ? 'villa' : listing.category_name || '').toLowerCase();
  const address = {
    '@type': 'PostalAddress',
    ...(listing.quartier ? { streetAddress: listing.quartier } : {}),
    // The listing's own city and province (lib/cities.js), the commune by its
    // plain name — never "Kinshasa" for a Lubumbashi house.
    addressLocality: listing.commune ? communeLabel(listing.commune) : cityOfListing(listing),
    addressRegion: provinceOfCity(cityOfListing(listing)) || cityOfListing(listing),
    addressCountry: 'CD',
  };
  const about = {
    '@type': SCHEMA_TYPES[category] || 'Accommodation',
    name: listing.title,
    address,
    ...(Number(listing.beds) > 0 ? { numberOfBedrooms: Number(listing.beds) } : {}),
    ...(Number(listing.bath) > 0 ? { numberOfBathroomsTotal: Number(listing.bath) } : {}),
    ...(hasArea(listing.area) ? { floorSize: { '@type': 'QuantitativeValue', value: Number(listing.area), unitCode: 'MTK' } } : {}),
  };
  const offer = price
    ? {
        '@type': 'Offer',
        price,
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
        businessFunction: listing.purpose === 'rent' ? 'http://purl.org/goodrelations/v1#LeaseOut' : 'http://purl.org/goodrelations/v1#Sell',
        ...(listing.purpose === 'rent'
          ? { priceSpecification: { '@type': 'UnitPriceSpecification', price, priceCurrency: 'USD', unitCode: SCHEMA_UNIT_CODES[listing.price_period] || 'MON' } }
          : {}),
      }
    : undefined;
  const posted = listing.created_at ? new Date(listing.created_at) : null;

  const crumbs = [{ name: t('breadcrumb.home'), item: `${base()}${loc('/') === '/' ? '' : loc('/')}` }, { name: t('breadcrumb.listings'), item: `${base()}/listings` }];
  const communeLink = communeHref(listing);
  if (communeLink) crumbs.push({ name: communeLabel(listing.commune), item: `${base()}${loc(communeLink)}` });
  crumbs.push({ name: listing.title, item: url });

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'RealEstateListing',
        '@id': `${url}#listing`,
        url,
        name: listingMetaTitle(listing, t),
        ...(listing.description ? { description: clip(String(listing.description).replace(/\s+/g, ' ').trim(), 500) } : {}),
        ...(images.length ? { image: images } : {}),
        ...(posted && !Number.isNaN(posted.getTime()) ? { datePosted: posted.toISOString() } : {}),
        about,
        ...(offer ? { offers: offer } : {}),
        provider: { '@id': `${base()}/#organization`, '@type': 'Organization', name: 'Lukka Place', url: base() },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.item })),
      },
    ],
  };
}

/** The type as a heading word: "Appartement" in French, "Apartment" on an English page. */
export function listingKindLabel(listing, t) {
  return t?.locale === 'en' ? capitalise(kindOf(listing, t)) : typeLabel(listing, t);
}
