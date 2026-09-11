import { notFound } from 'next/navigation';
import { getT } from '@/lib/i18n/server';
import Link from 'next/link';
import { MapPin, ArrowRight } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import PhotoGallery from '@/components/PhotoGallery';
import KeyFacts from '@/components/KeyFacts';
import EntryCostsBreakdown from '@/components/EntryCostsBreakdown';
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
async function AgentProfileLink({ agentId }) {
  if (!agentId) return null;
  const t = await getT();

  return (
    <Link
      href={`/agents/${agentId}`}
      className="u-press group inline-flex items-center justify-center gap-1.5 rounded-lg border border-line px-5 py-2.5 text-sm font-semibold text-ink-70 transition-colors hover:border-ink-25 hover:text-ink"
    >
      {t('listings.detail.viewAgentProfile')}
      <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/**
 * Property detail — the conversion page.
 *
 * Structure follows Rightmove's own layout architecture: breadcrumb, then
 * a full-width hero gallery spanning the entire 1280px canvas, then a
 * 68/32 two-column split — narrative on the left, a permanently sticky
 * rail (agent contact + price/FX breakdown) on the right that stays docked
 * through Description, Équipements and Emplacement — closing with a map
 * and a rail of other properties.
 *
 * The related rail is the important addition. This page previously ended
 * after the description with nothing to click, so a visitor who did not want
 * this particular property left the site. It falls back to a city-wide
 * search when the commune has nothing else, and says so rather than
 * implying the results are nearby.
 */
export default async function ListingDetailPage({ params, searchParams }) {
  const t = await getT();
  const { id } = await params;
  const sp = await searchParams;
  const visitSent = sp.visit_sent === '1';
  const visitError = typeof sp.visit_error === 'string' ? sp.visit_error : null;
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
  // The address line only earns its place when it says something the heading
  // doesn't. Two ways it can end up saying the same thing: locationLine()
  // itself falls back to `address` when quartier/commune are both missing (so
  // they'd be byte-identical), and even when it doesn't, the stored address is
  // usually that same "Quartier, Commune" plus a trailing ", Kinshasa" the
  // engine appends on every listing (buildAddress(), services/postgres.js).
  // Now that the heading IS the location, printing both would state the place
  // twice on consecutive lines.
  const addressDetail = (() => {
    const address = typeof listing.address === 'string' ? listing.address.trim() : '';
    if (!address) return null;
    if (!where) return address;
    const normalize = (value) => value.toLowerCase().replace(/[\s,]+/g, ' ').trim();
    const a = normalize(address);
    const w = normalize(where);
    // Subtract what the heading already says, plus the city the engine
    // appends to every address, and keep the line only if real content
    // survives. A plain `a.includes(w)` test would have been wrong in the
    // one case this line actually matters: "12 Avenue Kasai, Ngiri-Ngiri"
    // contains the heading "Ngiri-Ngiri", but the street number is new
    // information and suppressing it would throw away the most specific
    // thing on the page.
    const remainder = a.replace(w, ' ').replace(/\bkinshasa\b/g, ' ').replace(/[^a-z0-9]+/g, '');
    return remainder ? address : null;
  })();
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
    // pb-28: clears MobileListingBar.js, fixed at the true `bottom-0` now
    // (it used to sit at bottom-16, above the fixed BottomNav.js tab bar
    // this page's own pb-24 was accounting for alongside it — that bar is
    // gone entirely, see app/(site)/layout.js, but MobileListingBar's own
    // height plus a phone's real safe-area-inset-bottom can still run
    // close to 96px, so this went up slightly rather than down to keep a
    // real margin above it.
    <div className="pb-28 lg:pb-0">
      <ListingViewTracker path={`/listings/${listing.id}`} commune={listing.commune} />
      <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex items-center justify-between gap-4">
          <Breadcrumb
            className="min-w-0"
            items={[
              { label: t('breadcrumb.home'), href: '/' },
              { label: t('breadcrumb.listings'), href: '/listings' },
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

        {/* HERO MEDIA — full grid width, per an explicit instruction (this
            reverses an earlier one that had put the gallery inside the left
            column beside the agent card; the two instructions genuinely
            conflict and the newer one wins). The photos are the page's
            primary focal point and now span the whole 1280px canvas rather
            than ~68% of a narrower one. PhotoGallery carries its own
            `.u-lift` elevation and hairline — see that component's doc
            comment for why the gallery is a deliberate, scoped departure
            from this app's usual `.u-card` hairline-only treatment. */}
        <PhotoGallery images={images} alt={listing.title} />

        {/* Everything below the hero is the two-column split: narrative on
            the left, a permanently docked rail on the right. 68/32 as
            instructed, expressed in `fr` units rather than literal
            percentages so the 40px gap comes out of the tracks instead of
            overflowing the row (68% + 32% + gap > 100%). */}
        <div className="mt-8 grid gap-10 lg:mt-10 lg:grid-cols-[minmax(0,68fr)_minmax(0,32fr)] lg:items-start">
          <div className="flex w-full min-w-0 flex-col gap-7">
            {/* Price leads the page — the design's single loudest number,
                above the title rather than tucked into the enquiry panel. */}
            <div className="flex flex-col gap-2.5">
              {/* Explicit classes, not `.u-price` / `.u-h1`. Those globals are
                  24px/500 and 20px/500 — the "font-medium, washed out"
                  pairing this page was called out for — but they are shared
                  utilities (`.u-h1`/`.u-h2` also set every section heading,
                  `.u-body` three more files), so thickening them in place
                  would re-weight surfaces nobody asked to change. The
                  listing page carries its own weights instead, matched to
                  the feed card's. */}
              <span className="u-tabular text-[1.75rem] font-semibold leading-tight tracking-normal text-ink sm:text-[2rem]">
                <Price
                  amount={listing.price}
                  purpose={listing.purpose}
                  pricePeriod={listing.price_period}
                  showSubtext
                  subtextClassName="ml-2.5 inline-block rounded-md bg-canvas-alt px-2 py-0.5 align-middle text-[0.8125rem] font-medium leading-normal tracking-normal text-ink"
                />
              </span>

              {/* The address is the heading, the way Rightmove leads with
                  "The Risings, Walthamstow, E17" — and the way this app's own
                  feed card already does.
                  
                  It used to be `listing.title`, the agent-written sentence
                  ("2 chambres — Appartement à louer à Kalamu"). That sentence
                  restates, in prose, exactly what the KeyFacts grid two rows
                  below now states as structured data (Type de bien /
                  Chambres / Salles de bain), which is the substitution this
                  change was asked for. `listing.title` is NOT dropped from
                  the page's identity — it still carries the <title>, the
                  OpenGraph title and the breadcrumb's final crumb (see
                  generateMetadata above), so search engines and shared links
                  keep the descriptive phrasing. */}
              <h1 className="text-xl font-medium leading-snug tracking-normal text-ink sm:text-2xl">
                {where || listing.title}
              </h1>

              {addressDetail ? (
                <p className="inline-flex items-center gap-1.5 text-[0.875rem] font-normal text-ink">
                  <MapPin strokeWidth={2.25} className="h-4 w-4 shrink-0" />
                  {addressDetail}
                </p>
              ) : null}
            </div>

            <KeyFacts listing={listing} />

            {/* Directly under the facts grid: that grid states the deal in the
                agent's own notation ("4 + 1 mois"), this says who receives each
                part and what comes back. Renders nothing when a listing states
                only a guarantee. */}
            <EntryCostsBreakdown listing={listing} />

            {/* Mobile only: the sticky right rail is off-screen below lg. */}
            <div className="flex flex-col gap-4 lg:hidden">
              <EnquiryCard listing={listing} visitSent={visitSent} visitError={visitError} />
              <AgentProfileLink agentId={listing.agent_id} />
              <PricePanel listing={listing} />
            </div>

            {listing.description ? (
              <div className="flex flex-col gap-3">
                <h2 className="u-h2 text-ink">{t('listings.detail.description')}</h2>
                <p className="u-body max-w-[46rem] whitespace-pre-line text-ink-70">
                  {listing.description}
                </p>
              </div>
            ) : null}

            {amenityKeys.length > 0 ? (
              <div className="flex flex-col gap-3.5">
                <h2 className="u-h2 text-ink">{t('listings.detail.confirmedAmenities')}</h2>
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
                <p className="max-w-[42rem] text-[0.8125rem] leading-[1.5] text-ink-35">
                  Les équipements proviennent du texte de l&apos;annonce, revu à la publication. Ils ne sont pas issus
                  d&apos;un champ structuré de la base — un bien peut en disposer sans l&apos;avoir précisé.
                </p>
              </div>
            ) : null}

            <div className="flex flex-col gap-3">
              <h2 className="u-h2 text-ink">{t('listings.detail.location')}</h2>
              <ListingLocationMap listing={listing} />
            </div>
          </div>

          {/* The rail stays docked for the whole scroll — Description,
              Équipements and Emplacement all pass behind it. `self-start`
              is what actually makes `sticky` work inside a grid: without
              it the item stretches to the row's full height and has no
              room left to stick within. top-24 clears the fixed header. */}
          <aside className="hidden w-full self-start lg:sticky lg:top-24 lg:flex lg:flex-col lg:space-y-4">
            <EnquiryCard listing={listing} visitSent={visitSent} visitError={visitError} />
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
