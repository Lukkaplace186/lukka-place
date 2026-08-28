import { notFound } from 'next/navigation';
import Link from 'next/link';
import { MapPin, ArrowRight } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import PhotoGallery from '@/components/PhotoGallery';
import KeyFacts from '@/components/KeyFacts';
import Price from '@/components/Price';
import PricePanel from '@/components/PricePanel';
import EnquiryCard from '@/components/EnquiryCard';
import ListingLocationMap from '@/components/ListingLocationMap';
import RelatedListings from '@/components/RelatedListings';
import MobileListingBar from '@/components/MobileListingBar';
import ShareButton from '@/components/ShareButton';
import FavoriteButton from '@/components/FavoriteButton';
import { AmenityTag } from '@/components/ListingBadges';
import { getListingById, getListings, getSimilarListings } from '@/lib/listings';
import { listingImages, locationLine, matchedAmenityKeys } from '@/lib/listingView';
import { formatPrice } from '@/lib/format';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import ListingViewTracker from '@/components/ListingViewTracker';

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
 * Directly under EnquiryCard, only when this listing actually has a real
 * `agent_id` (see lib/listings.js's SELECT_FIELDS — NULL on every listing
 * with no agent attached, same honesty rule EnquiryCard's own
 * "Appeler l'agent" button follows: render nothing rather than a link to a
 * profile that doesn't exist). Routes to the real /agents/[id] directory
 * page (app/(portfolio)/agents/[id]/page.js), not a guessed id.
 */
function AgentProfileLink({ agentId }) {
  if (!agentId) return null;

  return (
    <Link
      href={`/agents/${agentId}`}
      className="u-press group inline-flex items-center justify-center gap-1.5 rounded-lg border border-line px-5 py-2.5 text-sm font-semibold text-ink-70 transition-colors hover:border-ink-25 hover:text-ink"
    >
      Voir le profil de l&apos;agent
      <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
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
  // Up to 5 here rather than a card's 2 — the detail page has a dedicated
  // "Équipements" section with room for the full matched set.
  const amenityKeys = matchedAmenityKeys(listing, 5);

  // Real pgvector cosine-similarity match against this listing's own stored
  // embedding (services/embeddings.js, engine repo — written on every
  // publish) tried first: it can surface a genuinely similar property the
  // plain commune filter below would miss entirely (same kind of unit and
  // price range, different neighborhood). Falls back to the previous
  // commune-then-citywide chain when there's no embedding yet or nothing
  // comes back — never a dead rail.
  let related = await getSimilarListings(listing.id, 6);
  let relatedMode = 'similar';
  let widened = false;

  if (related.length === 0) {
    relatedMode = 'commune';
    if (listing.commune) {
      const { data } = await getListings({ commune: listing.commune, excludeId: listing.id, limit: 6 });
      related = data;
    }
    if (related.length === 0) {
      const { data } = await getListings({ excludeId: listing.id, limit: 6 });
      related = data;
      widened = Boolean(listing.commune);
    }
  }

  return (
    <div className="pb-24 lg:pb-0">
      <ListingViewTracker path={`/listings/${listing.id}`} commune={listing.commune} />
      <div className="mx-auto max-w-[1600px] px-4 pt-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex items-center justify-between gap-4">
          <Breadcrumb
            className="min-w-0"
            items={[
              { label: 'Accueil', href: '/' },
              { label: 'Annonces', href: '/listings' },
              ...(listing.commune
                ? [{ label: listing.commune, href: `/listings?commune=${encodeURIComponent(listing.commune)}` }]
                : []),
              { label: listing.title },
            ]}
          />

          {/* Zoopla-style top-right action pair — Partager/Sauvegarder,
              both real (Web Share API with a clipboard fallback; the same
              localStorage favorite every other heart on the site reads),
              not decorative buttons duplicating EnquiryCard's own pair
              lower down. */}
          <div className="flex shrink-0 items-center gap-2">
            <ShareButton title={listing.title} />
            <FavoriteButton listingId={listing.id} variant="label" />
          </div>
        </div>

        <PhotoGallery images={images} alt={listing.title} createdAt={listing.created_at} />

        {/* web/Design's detail layout: a 400px right rail, not 23rem/368px,
            and 40px between the columns. */}
        <div className="mt-9 grid gap-10 lg:grid-cols-[minmax(0,1fr)_25rem] lg:items-start">
          <div className="flex min-w-0 flex-col gap-7">
            {/* Price leads the page at 44px/800 — the design's single
                loudest number, above the title rather than tucked into the
                enquiry panel. */}
            <div className="flex flex-col gap-2.5">
              <span className="u-tabular text-[2.25rem] font-extrabold leading-none tracking-[-0.025em] text-ink sm:text-[2.75rem]">
                <Price
                  amount={listing.price}
                  purpose={listing.purpose}
                  pricePeriod={listing.price_period}
                  showSubtext
                  subtextClassName="ml-3 text-[1rem] font-normal tracking-normal text-ink-45"
                />
              </span>

              <h1 className="text-[1.3125rem] font-bold leading-[1.3] tracking-[-0.008em] text-ink">
                {listing.title}
              </h1>

              {(listing.address || where) ? (
                <p className="inline-flex items-center gap-1.5 text-[0.875rem] text-ink-45">
                  <MapPin strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" />
                  {listing.address || where}
                </p>
              ) : null}
            </div>

            <KeyFacts listing={listing} />

            {/* Mobile only: the sticky right rail is off-screen below lg. */}
            <div className="lg:hidden">
              <EnquiryCard listing={listing} />
              <AgentProfileLink agentId={listing.agent_id} />
            </div>

            {listing.description ? (
              <div className="flex flex-col gap-3">
                <h2 className="text-[1.125rem] font-bold text-ink">Description</h2>
                <p className="max-w-[41rem] whitespace-pre-line text-[1rem] leading-[1.6] text-ink-70">
                  {listing.description}
                </p>
              </div>
            ) : null}

            {amenityKeys.length > 0 ? (
              <div className="flex flex-col gap-3.5">
                <h2 className="text-[1.125rem] font-bold text-ink">Équipements confirmés par l&apos;agent</h2>
                <div className="flex flex-wrap gap-2">
                  {amenityKeys.map((key) => <AmenityTag key={key} amenityKey={key} />)}
                </div>
                {/* The design's heading claims agent confirmation, and its
                    own caption immediately qualifies how: these come from
                    the listing text, not a structured column. Both are true
                    here — the description is written by the agent who
                    submitted the listing, and it passes the approve_status
                    moderation gate before publication — so the design's
                    wording is kept verbatim. The caption is what carries the
                    honesty; the heading alone would overclaim. */}
                <p className="max-w-[39rem] text-[0.8125rem] leading-[1.45] text-ink-35">
                  Les équipements proviennent du texte de l&apos;annonce, revu à la publication. Ils ne sont pas issus
                  d&apos;un champ structuré de la base — un bien peut en disposer sans l&apos;avoir précisé.
                </p>
              </div>
            ) : null}

            <div className="flex flex-col gap-3">
              <h2 className="text-[1.125rem] font-bold text-ink">Emplacement</h2>
              <ListingLocationMap listing={listing} />
            </div>
          </div>

          <aside className="hidden lg:sticky lg:top-24 lg:flex lg:flex-col lg:gap-5">
            <EnquiryCard listing={listing} />
            <AgentProfileLink agentId={listing.agent_id} />
            <PricePanel listing={listing} />
          </aside>
        </div>
      </div>

      <div className="mt-16">
        <RelatedListings listings={related} commune={listing.commune} widened={widened} mode={relatedMode} />
      </div>

      <MobileListingBar listing={listing} />
    </div>
  );
}
