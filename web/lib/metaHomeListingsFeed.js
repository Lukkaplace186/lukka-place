import { SITE_URL } from './constants';
import { listingImages } from './listingView';
import { listingPublicUrl } from './listingShareCopy';
import { KINSHASA_COMMUNE_CENTROIDS } from './geocoding';

/**
 * The Meta "home listings" catalogue feed (2026-11-04), served at
 * /feeds/meta-home-listings.csv. Meta Commerce Manager fetches it on a
 * schedule; a catalogue lets retargeting ads show each person the listing
 * they actually looked at (ViewContent carries the listing id as
 * content_ids — components/AdTracking.js).
 *
 * Column names and enum values follow Meta's home listing feed spec as
 * documented publicly; they were written without a live catalogue, so the
 * first upload's diagnostics in Commerce Manager are the check.
 *
 * Only what we can stand behind goes in:
 *  - public listings only (the caller reads through the public gate), and
 *    not under offer — an ad for a property nobody can take is a dead end;
 *  - a real price in USD, monthly for a rent: a daily / weekly / yearly rent
 *    is left out rather than converted (a short stay ×30 is not a monthly
 *    rent, and Meta has no period field);
 *  - at least one usable photo (Meta refuses an item without one);
 *  - a position: the listing's stored point, else its commune's verified
 *    centroid (the same fallback the public map uses), ROUNDED to 2 decimals
 *    (~1 km). The listing page itself only shows a 500 m zone, so the feed
 *    must not publish a sharper point than the page does;
 *  - residential only: Meta's property types are homes, and an office has no
 *    honest one among them.
 */

export const META_FEED_COLUMNS = [
  'home_listing_id',
  'name',
  'availability',
  'listing_type',
  'property_type',
  'price',
  'url',
  'image[0].url',
  'image[1].url',
  'image[2].url',
  'description',
  'num_beds',
  'num_baths',
  'address.addr1',
  'address.city',
  'address.region',
  'address.country',
  'neighborhood[0]',
  'latitude',
  'longitude',
];

/** Lower-cased category names → Meta's property_type. Anything else is left out. */
const PROPERTY_TYPE_BY_CATEGORY = {
  appartement: 'apartment',
  studio: 'apartment',
  duplex: 'apartment',
  penthouse: 'apartment',
  'chambre / annexe': 'apartment',
  chambre: 'apartment',
  maison: 'house',
  villa: 'house',
  concession: 'house',
  terrain: 'land',
  'ferme / terrain agricole': 'land',
  ferme: 'land',
};

const MAX_DESCRIPTION = 5000;

function absoluteUrl(src) {
  return src.startsWith('/') ? `${SITE_URL}${src}` : src;
}

function position(listing) {
  const lat = Number.parseFloat(listing.latitude);
  const lng = Number.parseFloat(listing.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    return { lat, lng };
  }
  return KINSHASA_COMMUNE_CENTROIDS[listing.commune] || null;
}

/** Meta's property_type for a listing row, or null (not a home we can name). */
export function metaPropertyType(listing) {
  if (listing.category_type === 'commercial') return null;
  return PROPERTY_TYPE_BY_CATEGORY[String(listing.category_name || '').trim().toLowerCase()] || null;
}

/**
 * One feed row from a public listing row (lib/listings.js SELECT_FIELDS), or
 * null with nothing invented when the listing cannot honestly be an item.
 */
export function metaFeedItem(listing) {
  if (!listing?.id) return null;
  if (listing.listing_status && listing.listing_status !== 'active') return null;

  const isRent = listing.purpose === 'rent';
  if (!isRent && listing.purpose !== 'sale') return null;
  if (isRent && listing.price_period && listing.price_period !== 'mois') return null;
  const price = Number(listing.price);
  if (!Number.isFinite(price) || price <= 0) return null;

  const propertyType = metaPropertyType(listing);
  if (!propertyType) return null;

  const images = listingImages(listing).slice(0, 3).map(absoluteUrl);
  if (images.length === 0) return null;

  const point = position(listing);
  if (!point) return null;

  const city = listing.city_name || 'Kinshasa';
  const place = [listing.quartier, listing.commune].filter(Boolean).join(', ');
  const name = String(listing.title || '').trim() || [listing.category_name, place].filter(Boolean).join(' — ');
  const description = String(listing.description || listing.title || name).replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION);

  return {
    home_listing_id: String(listing.id),
    name,
    availability: isRent ? 'for_rent' : 'for_sale',
    listing_type: isRent ? 'for_rent_by_agent' : 'for_sale_by_agent',
    property_type: propertyType,
    price: `${Math.round(price)} USD`,
    url: listingPublicUrl(listing.id, { source: 'facebook', medium: 'catalogue' }),
    'image[0].url': images[0] || '',
    'image[1].url': images[1] || '',
    'image[2].url': images[2] || '',
    description,
    num_beds: Number.isInteger(Number(listing.beds)) && Number(listing.beds) > 0 ? String(Number(listing.beds)) : '',
    num_baths: Number.isInteger(Number(listing.bath)) && Number(listing.bath) > 0 ? String(Number(listing.bath)) : '',
    'address.addr1': place || listing.commune || city,
    'address.city': city,
    'address.region': city,
    'address.country': 'CD',
    'neighborhood[0]': listing.quartier || listing.commune || '',
    latitude: point.lat.toFixed(2),
    longitude: point.lng.toFixed(2),
  };
}

/** RFC 4180: every field quoted, quotes doubled, a leading formula character neutralised. */
function csvField(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function metaFeedCsv(items) {
  const lines = [META_FEED_COLUMNS.map(csvField).join(',')];
  for (const item of items) lines.push(META_FEED_COLUMNS.map((col) => csvField(item[col])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
