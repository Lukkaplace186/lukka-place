import { notFound } from 'next/navigation';
import Breadcrumb from '@/components/Breadcrumb';
import PhotoGallery from '@/components/PhotoGallery';
import PropertyMetrics from '@/components/PropertyMetrics';
import EnquiryCard from '@/components/EnquiryCard';
import ListingLocationMap from '@/components/ListingLocationMap';
import RelatedListings from '@/components/RelatedListings';
import MobileListingBar from '@/components/MobileListingBar';
import { getListingById, getListings } from '@/lib/listings';
import { listingImages, typeLabel, locationLine } from '@/lib/listingView';
import { formatPrice } from '@/lib/format';

/**
 * `openGraph`/`twitter` here are what WhatsApp's own link-preview crawler
 * reads when a visitor shares this URL — the platform's core discovery
 * channel had zero rich-preview support before this (bare link, no photo,
 * no price). Uses the listing's own real first photo (already resolved via
 * listingImages(), no new query) and real formatted price — never a
 * placeholder image or invented copy. `metadataBase` on the root layout is
 * what lets this image URL resolve to an absolute one.
 */
export async function generateMetadata({ params }) {
  const { id } = await params;
  const listing = await getListingById(id);
  if (!listing) return {};

  const title = `${listing.title} — Lukka Place`;
  const description = listing.description?.slice(0, 160);
  const priceText = formatPrice(listing.price, listing.purpose, listing.price_period);
  const ogTitle = `${priceText} — ${listing.title}`;
  const image = listingImages(listing)[0];

  return {
    title,
    description,
    openGraph: {
      title: ogTitle,
      description,
      type: 'website',
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: ogTitle,
      description,
      images: image ? [image] : undefined,
    },
  };
}

/**
 * Property detail — the conversion page.
 *
 * Structure follows the reference portals: breadcrumb, gallery, then a
 * two-column split with the narrative on the left and a sticky enquiry
 * panel on the right, closing with a map and a rail of other properties.
 *
 * The related rail is the important addition. This page previously ended
 * after the description with nothing to click, so a visitor who did not want
 * this particular property left the site. It falls back to a city-wide
 * search when the commune has nothing else, and says so rather than
 * implying the results are nearby.
 */
export default async function ListingDetailPage({ params }) {
  const { id } = await params;
  const listing = await getListingById(id);

  // Covers both "no such id" and "exists but is not approved" —
  // getListingById applies the same status=1/approve_status=1 filter as the
  // results grid, so a guessed or leaked URL to a pending listing 404s
  // exactly as it would be absent from search.
  if (!listing) {
    notFound();
  }

  const images = listingImages(listing);
  const where = locationLine(listing);
  const type = typeLabel(listing);

  // Other properties in the same commune, this one excluded. Widen to the
  // whole city when the commune has nothing else to show.
  let related = [];
  let widened = false;
  if (listing.commune) {
    const { data } = await getListings({ commune: listing.commune, excludeId: listing.id, limit: 6 });
    related = data;
  }
  if (related.length === 0) {
    const { data } = await getListings({ excludeId: listing.id, limit: 6 });
    related = data;
    widened = Boolean(listing.commune);
  }

  return (
    <div className="pb-24 lg:pb-0">
      <div className="mx-auto max-w-[1600px] px-4 pt-6 sm:px-6 lg:px-8">
        <Breadcrumb
          className="mb-5"
          items={[
            { label: 'Accueil', href: '/' },
            { label: 'Annonces', href: '/listings' },
            ...(listing.commune
              ? [{ label: listing.commune, href: `/listings?commune=${encodeURIComponent(listing.commune)}` }]
              : []),
            { label: listing.title },
          ]}
        />

        <PhotoGallery images={images} alt={listing.title} />

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start lg:gap-12">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {type ? (
                <span className="rounded-full bg-blue-tint px-3 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-blue-deep">
                  {type}
                </span>
              ) : null}
              {where ? <span className="u-eyebrow">{where}</span> : null}
            </div>

            <h1 className="mt-3 font-display text-[1.75rem] font-normal leading-[1.15] tracking-[-0.02em] text-ink sm:text-[2.25rem]">
              {listing.title}
            </h1>

            {listing.address ? <p className="mt-2 text-[0.9375rem] text-ink-45">{listing.address}</p> : null}

            {/* Mobile only: the sticky EnquiryCard is off-screen below lg,
                and the price should not require a scroll to the bottom. */}
            <div className="mt-6 lg:hidden">
              <EnquiryCard listing={listing} />
            </div>

            <div className="mt-10">
              <h2 className="u-eyebrow mb-4">Caractéristiques</h2>
              <PropertyMetrics listing={listing} />
            </div>

            {listing.description ? (
              <div className="mt-10">
                <h2 className="font-display text-xl font-normal tracking-[-0.01em] text-ink">Description</h2>
                <p className="mt-3 whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-70">
                  {listing.description}
                </p>
              </div>
            ) : null}

            <div className="mt-10">
              <h2 className="font-display text-xl font-normal tracking-[-0.01em] text-ink">Localisation</h2>
              <div className="mt-4">
                <ListingLocationMap listing={listing} />
              </div>
            </div>
          </div>

          <aside className="hidden lg:sticky lg:top-24 lg:block">
            <EnquiryCard listing={listing} />
          </aside>
        </div>
      </div>

      <div className="mt-16">
        <RelatedListings listings={related} commune={listing.commune} widened={widened} />
      </div>

      <MobileListingBar listing={listing} />
    </div>
  );
}
