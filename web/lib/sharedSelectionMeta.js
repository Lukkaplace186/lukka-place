import { formatPrice } from '@/lib/format';
import { listingImages, specItems, feedLocationLine } from '@/lib/listingView';

/**
 * `?ids=` as the ordered list of numeric ids the sharer sent. Order matters:
 * the first id is the one the preview card is built from, and
 * getListingsByIds returns rows by recency, not in the link's order.
 */
export function parseShareIds(raw) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return [];
  return String(value)
    .split(',')
    .map((part) => Number.parseInt(part, 10))
    .filter((id) => Number.isFinite(id) && id > 0);
}

/**
 * The WhatsApp/Open Graph card for a shared `/favoris?ids=` link.
 *
 * Before this the page was a client component with no metadata of its own,
 * so every shared selection unfurled as the site's generic card — logo, no
 * photo, no price — while a shared listing link showed the property. The card
 * is built from the first shared listing that is still public (same approval
 * filter as everywhere, via getListingsByIds), using the same real cover photo
 * and formatted price the listing detail page's own preview uses. Further
 * listings are counted, not described: a preview card has one image.
 *
 * Returns null when nothing shared is still public — the caller then keeps
 * the site's default card rather than previewing a listing that is gone.
 */
export function sharedSelectionMetadata(ids, listings, t) {
  const byId = new Map((listings || []).map((l) => [Number(l.id), l]));
  const live = ids.map((id) => byId.get(id)).filter(Boolean);
  if (live.length === 0) return null;

  const primary = live[0];
  const others = live.length - 1;
  const price = formatPrice(primary.price, primary.purpose, primary.price_period);
  const title = t('account.favorites.shareCard.title', { subject: primary.title, price });

  const facts = specItems(primary, t).map((spec) => `${spec.value} ${spec.label}`);
  const where = feedLocationLine(primary);
  const parts = [...facts, where].filter(Boolean);
  if (others > 0) parts.push(t('account.favorites.shareCard.more', { count: others }));
  const description = parts.join(' • ') || undefined;

  const image = listingImages(primary)[0];

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}
