import { notFound } from 'next/navigation';
import { getLocale, getT, localizedAlternates } from '@/lib/i18n/server';
import { listingStaticMapSrc } from '@/lib/staticMap';
import Link from '@/components/LocaleLink';
import { MapPin, ArrowRight } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import PhotoGallery from '@/components/PhotoGallery';
import EntryCostsBreakdown from '@/components/EntryCostsBreakdown';
import ProjectFitLine from '@/components/ProjectFitLine';
import Price from '@/components/Price';
import PricePanel from '@/components/PricePanel';
import EnquiryCard from '@/components/EnquiryCard';
import ListingLocationMap from '@/components/ListingLocationMap';
import RelatedListings from '@/components/RelatedListings';
import MobileListingBar from '@/components/MobileListingBar';
import ShareButton from '@/components/ShareButton';
import FavoriteButton from '@/components/FavoriteButton';
import { cache, Suspense } from 'react';
import { getListingById as readListingById, getListings, getSimilarListings } from '@/lib/listings';
import { listingImages, locationLine, entryCostBreakdown } from '@/lib/listingView';
import { formatPrice } from '@/lib/format';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import ListingViewTracker from '@/components/ListingViewTracker';
import PropertyDescription from '@/components/listings/PropertyDescription';
import AvailabilityConfirmedBadge from '@/components/listings/AvailabilityConfirmedBadge';
import MarketMedianLine from '@/components/listings/MarketMedianLine';
import ListingEquipment from '@/components/listings/ListingEquipment';
import ListingFactsRow from '@/components/listings/ListingFactsRow';
import ListingAgentRow from '@/components/listings/ListingAgentRow';
import { listingVideos } from '@/lib/listingVideos';
import ListingSectionNav from '@/components/listings/ListingSectionNav';
import ProjectUnitStrip from '@/components/projects/ProjectUnitStrip';
import JsonLd from '@/components/seo/JsonLd';
import { similarAlertQuery, transactionTypeOfPurpose } from '@/lib/similarSearch';
import SimilarAlertButton from '@/components/SimilarAlertButton';
import { listingPath } from '@/lib/listingSlug';
import { communeHref, listingJsonLd, listingKindLabel, listingMetaDescription, listingMetaTitle } from '@/lib/listingSeo';

// generateMetadata and the page both read the listing; per-request dedupe so
// one visit costs one query, not two. Per request only (React cache): an
// approval or a price change still shows on the very next visit.
const getListingById = cache(readListingById);

/**
 * `openGraph`/`twitter` here are what WhatsApp's own link-preview crawler
 * reads when a visitor shares this URL — the platform's core discovery
 * channel had zero rich-preview support before this (bare link, no photo,
 * no price). Real formatted price, real facts — never invented copy.
 *
 * The IMAGE is not set here: ./opengraph-image.js and ./twitter-image.js draw
 * the listing's preview card (cover photo, price, specs, heading) and Next
 * puts them in the <head> ahead of anything this returns (2026-10-26; it was
 * the bare cover photo). `metadataBase` on the root layout makes their URLs
 * absolute.
 */
export async function generateMetadata({ params }) {
  const { id } = await params;
  const listing = await getListingById(id);
  if (!listing) return {};

  // Built from the listing's structured facts (type, bedrooms, commune,
  // price) — what people actually type into Google — not the agent's own
  // free-text title. lib/listingSeo.js.
  const t = await getT();
  const title = `${listingMetaTitle(listing, t)} | Lukka Place`;
  const description = listingMetaDescription(listing, t);
  const priceText = formatPrice(listing.price, listing.purpose, listing.price_period);
  const ogTitle = `${priceText} — ${listing.title}`;

  return {
    title,
    description,
    // Shared links carry ?utm_source= (lib/listingShareCopy.js SHARE_SOURCES);
    // every tagged variant is the same page.
    // The keyword URL is canonical (lib/listingSlug.js): /listings/509 and any
    // older slug open the same page and point Google at this one address.
    alternates: await localizedAlternates(listingPath(listing)),
    openGraph: {
      title: ogTitle,
      description,
      type: 'website',
    },
    twitter: {
      // The card always exists, photo or not (no photo draws the royal panel).
      card: 'summary_large_image',
      title: ogTitle,
      description,
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
// A section boundary on the listing page: a hairline, not a card (2026-11-18).
const RULE = 'border-t border-line pt-6';

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
  const visitSent = sp.visit_sent === '1' ? 'agent' : sp.visit_sent === 'team' ? 'team' : null;
  const visitError = typeof sp.visit_error === 'string' ? sp.visit_error : null;
  // A video visit's confirmation carries the payment warning (lib/visitMode.js);
  // `mode=video` is what the visit action adds to the redirect.
  const visitVideo = Boolean(visitSent) && sp.mode === 'video';
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
  const purposeLabel = listing.purpose === 'rent'
    ? t('listings.transaction.rent')
    : listing.purpose === 'sale' ? t('listings.transaction.sale') : null;
  // English pages name the type in English ("Apartment to rent"), lib/listingSeo.js.
  const kindLabel = listingKindLabel(listing, t);
  // "Appartement à louer" — leads the h1 (see there); the room counts are in
  // the facts row under it (ListingFactsRow) since 2026-11-18.
  const kindAndPurpose = [kindLabel, purposeLabel ? purposeLabel.toLowerCase() : null].filter(Boolean).join(' ');
  // Up to 5 here rather than a card's 2 — the detail page has a dedicated
  // "Équipements" section with room for the full matched set.

  // The phone's section strip names only sections this listing renders, so
  // a tab never jumps to nothing (components/listings/ListingSectionNav.js).
  // In page order (2026-11-18): the facts are in the opening block above the
  // strip, so "Aperçu" is gone from it; description and features, then the
  // costs card just before the map.
  const sectionNav = [
    listing.description ? { id: 'caracteristiques', label: t('listings.detail.sections.features') } : null,
    entryCostBreakdown(listing) ? { id: 'couts', label: t('listings.detail.sections.costs') } : null,
    { id: 'emplacement', label: t('listings.detail.sections.location') },
  ].filter(Boolean);

  // "M'alerter des biens similaires" — null when the listing states too
  // little to search on (lib/similarSearch.js).
  const alertQuery = similarAlertQuery(listing);
  const staticMapSrc = await listingStaticMapSrc(listing, await getLocale());

  return (
    // pb-28: clears MobileListingBar.js, fixed at the true `bottom-0` now
    // (it used to sit at bottom-16, above the fixed BottomNav.js tab bar
    // this page's own pb-24 was accounting for alongside it — that bar is
    // gone entirely, see app/(site)/layout.js, but MobileListingBar's own
    // height plus a phone's real safe-area-inset-bottom can still run
    // close to 96px, so this went up slightly rather than down to keep a
    // real margin above it.
    <div className="pb-28 lg:pb-0">
      <ListingViewTracker path={`/listings/${listing.id}`} commune={listing.commune} listingId={listing.id} price={listing.price} />
      <JsonLd data={listingJsonLd(listing, t)} />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 sm:pt-6 lg:px-8">
        {/* sm and up: breadcrumb left, Partager/Enregistrer right. On a
            phone neither row exists — the photo starts right under the
            header and the two actions sit on it (PhotoGallery's
            `mobileActions`), which gave back ~140px above the fold. */}
        <div className="mb-5 hidden items-center justify-between gap-4 sm:flex">
          <Breadcrumb
            className="min-w-0"
            items={[
              { label: t('breadcrumb.home'), href: '/' },
              { label: t('breadcrumb.listings'), href: '/listings' },
              ...(listing.commune
                ? [{ label: listing.commune, href: communeHref(listing) }]
                : []),
              { label: listing.title },
            ]}
          />

          <div className="flex shrink-0 items-center justify-end gap-2">
            <ShareButton title={listing.title} />
            <FavoriteButton listingId={listing.id} variant="label" price={listing.price} commune={listing.commune} />
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
        {/* The agent's videos play in the gallery itself (lib/listingVideos.js). */}
        <PhotoGallery
          images={images}
          videos={listingVideos(listing)}
          alt={listing.title}
          verifiedAt={listing.verified_at}
          eventListing={{ id: listing.id, price: listing.price, commune: listing.commune }}
          mobileActions={(
            <>
              <ShareButton title={listing.title} variant="overlay" />
              <FavoriteButton listingId={listing.id} price={listing.price} commune={listing.commune} />
            </>
          )}
        />

        {/* Everything below the hero is the two-column split: narrative on
            the left, a permanently docked rail on the right. 68/32 as
            instructed, expressed in `fr` units rather than literal
            percentages so the 40px gap comes out of the tracks instead of
            overflowing the row (68% + 32% + gap > 100%). */}
        <div className="mt-5 grid gap-8 sm:mt-8 sm:gap-10 lg:mt-10 lg:grid-cols-[minmax(0,68fr)_minmax(0,32fr)] lg:items-start">
          {/* The main column, phone and desktop (2026-11-18, owner: a smoother
              page after the big portals). One white page: an opening block,
              then sections separated by a hairline (RULE), not by cards — the
              entry costs are the one card left, just before the map. */}
          <div className="flex w-full min-w-0 flex-col gap-6">
            {/* Opening block: price, its FC equivalent (the rate date stays in
                the "≈" tooltip, <Price>), the heading, the address detail, the
                facts row and the reference. */}
            <div className="flex flex-col gap-2">
              {/* Explicit classes, not `.u-price` / `.u-h1`: those globals are
                  shared utilities, and this page carries its own weights,
                  matched to the feed card's. */}
              <span className="u-tabular text-[1.75rem] font-semibold leading-tight tracking-normal text-ink sm:text-[2rem]">
                <Price
                  amount={listing.price}
                  purpose={listing.purpose}
                  pricePeriod={listing.price_period}
                  showSubtext
                  /* "≈ 2,4 M FC / mois" as a quiet line under the price
                     (a pill until 2026-11-18). */
                  subtextClassName="mt-1 block text-[0.875rem] font-normal leading-normal tracking-normal text-ink-45"
                />
              </span>

              {/* The heading leads with what the property is and the
                  transaction, then the place — "Appartement à louer — Yolo
                  Nord I, Kalamu" (2026-10-24, the strongest on-page signal
                  search engines read). `listing.title` still carries the
                  <title>, OpenGraph title and breadcrumb. */}
              <h1 className="mt-1 text-xl font-medium leading-snug tracking-normal text-ink sm:text-2xl">
                {kindAndPurpose && where ? (
                  <>
                    <span className="font-semibold">{kindAndPurpose}</span>
                    {' — '}
                    {where}
                  </>
                ) : where || listing.title}
              </h1>

              {addressDetail ? (
                <p className="inline-flex items-center gap-1.5 text-[0.875rem] font-normal text-ink">
                  <MapPin strokeWidth={2.25} className="h-4 w-4 shrink-0" />
                  {addressDetail}
                </p>
              ) : null}

              {/* Type, rooms, bathrooms, surface… in one line, then the
                  reference (components/listings/ListingFactsRow.js). */}
              <div className="mt-1.5 empty:hidden">
                <ListingFactsRow listing={listing} />
              </div>

              {/* The agent's own weekly "still available" answer — only a
                  real one, at most 30 days old; nothing otherwise. */}
              <AvailabilityConfirmedBadge confirmedAt={listing.availability_confirmed_at} listingStatus={listing.listing_status ?? null} />

              {/* "Pour votre projet": how this home fits the signed-in
                  customer's move project, from real fields only. */}
              <Suspense fallback={null}>
                <ProjectFitLine listing={listing} />
              </Suspense>
            </div>

            <ListingSectionNav sections={sectionNav} label={t('listings.detail.sections.label')} />

            {/* Phone: who offers it, one row (the desktop rail has the card),
                then the compact EnquiryCard: only the visit-request feedback,
                the visit dialog the bottom bar's "Visiter" opens, and "Ajouter
                à mes visites". WhatsApp, Message, Visit and Call are the bottom
                bar's (owner, 2026-11-18: no second contact block). */}
            <div className={`flex flex-col gap-1 ${RULE} lg:hidden`}>
              <ListingAgentRow listing={listing} />
              <EnquiryCard listing={listing} visitSent={visitSent} visitVideo={visitVideo} visitError={visitError} saveShare={false} compact />
            </div>

            {/* The story: the description, cut to four lines, then the key
                features (components/listings/PropertyDescription.js). */}
            <div id="caracteristiques" className={`scroll-mt-32 empty:hidden ${RULE}`}>
              <PropertyDescription listing={listing} />
            </div>

            {listing.development_id ? <ProjectUnitStrip developmentId={listing.development_id} listingId={listing.id} /> : null}

            {/* "Équipements": utilities and practical details in one list, as
                the agent declared them, each fact once. */}
            <div className={`empty:hidden ${RULE}`}>
              <ListingEquipment listing={listing} />
            </div>

            {/* Streams in: a like-for-like median of live listings in the
                commune, only from 5 comparables up — and nothing at all
                until the site has 1,000 live listings (MarketMedianLine). */}
            <Suspense fallback={null}>
              <MarketMedianLine listing={listing} />
            </Suspense>

            {/* The entry costs (the "3 + 1 + 1" breakdown): the one card left
                on the page, just before the map (owner, 2026-11-18). Nothing
                for a listing that states none — a guarantee alone is in the
                facts row instead. */}
            <section className="rounded-2xl border border-line bg-surface p-5 empty:hidden sm:p-6">
              <EntryCostsBreakdown listing={listing} />
            </section>

            <div id="emplacement" className={`flex scroll-mt-32 flex-col gap-3 ${RULE}`}>
              <h2 className="u-h2 text-ink">{t('listings.detail.location')}</h2>
              <ListingLocationMap listing={listing} staticMapSrc={staticMapSrc} />
            </div>

          </div>

          {/* The rail stays docked for the whole scroll — Description,
              Équipements and Emplacement all pass behind it. `self-start`
              is what actually makes `sticky` work inside a grid: without
              it the item stretches to the row's full height and has no
              room left to stick within. top-24 clears the fixed header. */}
          <aside className="hidden w-full self-start lg:sticky lg:top-24 lg:flex lg:flex-col lg:space-y-4">
            <EnquiryCard listing={listing} visitSent={visitSent} visitVideo={visitVideo} visitError={visitError} placement="listing_desktop" />
            <AgentProfileLink agentId={listing.agent_id} />
            <PricePanel listing={listing} />
            <SimilarAlertButton query={alertQuery} />
          </aside>
        </div>
      </div>

      {/* Streamed: the similarity query and its fallbacks used to hold the
          whole page — photos and price included — until they answered. */}
      <Suspense fallback={null}>
        <RelatedSection listing={listing} alertQuery={alertQuery} />
      </Suspense>

      {/* No "Récemment consultés" here (2026-11-18, owner): it made every
          listing page longer, and the home page already shows it. */}

      <MobileListingBar listing={listing} />
    </div>
  );
}

/**
 * The "similar listings" rail, rendered after the rest of the page has
 * streamed (speed pass, 2026-11-06).
 *
 * Real pgvector cosine-similarity match against this listing's own stored
 * embedding (services/embeddings.js, engine repo — written on every
 * publish) tried first: it can surface a genuinely similar property the
 * plain commune filter below would miss entirely. Falls back to the
 * commune-then-citywide chain when there's no embedding yet or nothing
 * comes back — never a dead rail. The fallbacks keep rent with rent and sale
 * with sale, like the similarity rail (lib/similarSearch.js).
 */
async function RelatedSection({ listing, alertQuery }) {
  let related = await getSimilarListings(listing.id, 6);
  let relatedMode = 'similar';
  let widened = false;
  const transactionType = transactionTypeOfPurpose(listing.purpose);
  if (related.length === 0) {
    relatedMode = 'commune';
    if (listing.commune) {
      const { data } = await getListings({ commune: listing.commune, transactionType, excludeId: listing.id, limit: 6 });
      related = data;
    }
    if (related.length === 0) {
      const { data } = await getListings({ transactionType, excludeId: listing.id, limit: 6 });
      related = data;
      widened = Boolean(listing.commune);
    }
  }
  return (
    <div className="mt-16">
      <RelatedListings
        listings={related}
        commune={listing.commune}
        widened={widened}
        mode={relatedMode}
        footer={<SimilarAlertButton query={alertQuery} variant="inline" />}
      />
    </div>
  );
}
