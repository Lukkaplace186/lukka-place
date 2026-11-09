'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from '@/components/LocaleLink';
import {
  ArrowRight,
  ArrowUpDown,
  BadgeCheck,
  Bell,
  Building2,
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  Link2,
  MapPin,
  MessageCircle,
  Phone,
  Share2,
  Sparkles,
} from 'lucide-react';
import AgentAvatar from '@/components/AgentAvatar';
import CardImageCarousel from '@/components/CardImageCarousel';
import Price from '@/components/Price';
import FavoriteButton from '@/components/FavoriteButton';
import SafeImage from '@/components/SafeImage';
import SpecItem from '@/components/SpecItem';
import { Badge } from '@/components/ListingBadges';
import { WhatsAppIcon } from '@/components/WhatsAppCTA';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The public agent profile — Claude Design canvas "Agent Profile Redesign"
 * (2026-11-04, approved by the owner): a cover band carrying the photo of the
 * agency's newest listing under the royal wash, a white identity card
 * overlapping it (logo, name, verified + "Membre depuis", contact, two
 * figures), then the listings with the newest one featured, a contact rail
 * on a laptop, and an alert band.
 *
 * Royal blue is the only action colour here, WhatsApp included (the design
 * system's rule). Brass marks only the verified tier. No rating: the ratings
 * feature is not launched (owner, 2026-11-04).
 *
 * Everything shown is decided on the server (page.js): which number is
 * called (only a verified, routable one), the cover photo (a real listing's),
 * the "Nouveau" flag (the database clock's is_fresh) and "Réservé"
 * (listing_status under_offer).
 */
const SORTS = ['recent', 'priceAsc', 'priceDesc'];
// A description longer than this is clamped to three lines with "Lire la suite".
const BIO_CLAMP_CHARS = 220;
// The stats band's columns by number of figures — literal class names so
// Tailwind generates each one.
const STAT_GRID_COLS = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };
const DESKTOP_QUERY = '(min-width: 1024px)';

function subscribeDesktop(onChange) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function sortItems(items, sort) {
  const list = items.slice();
  if (sort === 'recent') return list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const price = (item) => (Number(item.price) > 0 ? Number(item.price) : null);
  return list.sort((a, b) => {
    const pa = price(a);
    const pb = price(b);
    if (pa === null) return pb === null ? 0 : 1;
    if (pb === null) return -1;
    return sort === 'priceAsc' ? pa - pb : pb - pa;
  });
}

// PropertyCard's price and FC pill, verbatim.
const CARD_PRICE_CLASS = 'u-tabular text-xl font-semibold leading-tight tracking-normal text-ink';
const CARD_FC_PILL_CLASS = 'ml-2 inline-block rounded-md bg-canvas-alt px-2 py-0.5 align-middle text-[0.75rem] font-normal leading-normal tracking-normal text-ink-45';

// Card press feedback is PropertyCard's, not `.u-press`: no shrink while the
// press is on the photo strip or a button. Scaling the strip's ancestor as a
// finger lands is how iOS Safari drops the swipe (CardImageCarousel's
// `data-card-photo`).
const CARD_CLASS =
  'group block h-full overflow-hidden rounded-[14px] border border-line/70 bg-surface transition-[box-shadow,translate,scale,border-color] duration-200 hover:-translate-y-0.5 hover:border-blue/20 hover:shadow-[0_10px_28px_-12px_rgba(12,29,80,0.28)] [&:active:not(:has(button:active)):not(:has([data-card-photo]:active))]:scale-[0.985]';

function Badges({ item, labels }) {
  return (
    <>
      {item.reserved ? <Badge tone="ink">{labels.reservedBadge}</Badge> : null}
      {item.isNew ? (
        <Badge tone="royal" className="gap-1">
          <Sparkles strokeWidth={2.25} className="h-3 w-3" aria-hidden="true" />
          {labels.newBadge}
        </Badge>
      ) : null}
    </>
  );
}

function PhotoOverlays({ item, labels }) {
  return (
    <>
      {item.isNew || item.reserved ? (
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
          <Badges item={item} labels={labels} />
        </div>
      ) : null}
      {/* FavoriteButton cancels the link's navigation itself, as on PropertyCard. */}
      <div className="absolute right-3 top-3 z-10">
        <FavoriteButton listingId={item.id} price={item.price} commune={item.commune} />
      </div>
    </>
  );
}

function ListingCard({ item, labels }) {
  return (
    <Link href={item.href} className={CARD_CLASS}>
      <div className="relative aspect-[3/2] w-full overflow-hidden bg-canvas-alt">
        {item.photos.length ? (
          <CardImageCarousel images={item.photos} alt={item.title} sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw" />
        ) : null}
        <PhotoOverlays item={item} labels={labels} />
      </div>
      <div className="@container flex flex-col gap-1 px-4 pb-4 pt-3">
        <Price
          amount={item.price}
          purpose={item.purpose}
          pricePeriod={item.pricePeriod}
          currency={item.currency}
          priceOriginal={item.priceOriginal}
          showSubtext
          className={`${CARD_PRICE_CLASS} @[19rem]:text-2xl`}
          subtextClassName={CARD_FC_PILL_CLASS}
        />
        {item.place ? (
          <p className="mt-0.5 truncate text-base font-medium leading-snug tracking-normal text-ink">{item.place}</p>
        ) : null}
        {item.type || item.specList.length ? (
          <div className="mt-0.5 flex items-center justify-between gap-3 text-[0.875rem] text-ink">
            <span className="truncate font-medium">{item.type}</span>
            <span className="flex flex-none items-center gap-3">
              {item.specList.map((spec) => <SpecItem key={spec.key} spec={spec} />)}
            </span>
          </div>
        ) : null}
      </div>
    </Link>
  );
}

/** The newest listing, wide: photo left, the facts and a "Voir le bien" right. */
function FeaturedCard({ item, labels }) {
  return (
    <Link href={item.href} className={`${CARD_CLASS} md:grid md:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]`}>
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-canvas-alt md:aspect-auto md:min-h-[22rem]">
        {item.photos.length ? (
          <CardImageCarousel images={item.photos} alt={item.title} sizes="(min-width: 1024px) 480px, (min-width: 768px) 60vw, 100vw" />
        ) : null}
        <PhotoOverlays item={item} labels={labels} />
      </div>
      <div className="flex flex-col justify-center gap-1.5 px-5 pb-5 pt-4 md:px-9 md:py-8">
        <span className="u-eyebrow text-blue">{labels.featuredEyebrow}</span>
        <Price
          amount={item.price}
          purpose={item.purpose}
          pricePeriod={item.pricePeriod}
          currency={item.currency}
          priceOriginal={item.priceOriginal}
          showSubtext
          className="u-tabular mt-1 text-[1.625rem] font-bold leading-tight tracking-tight text-ink md:text-[2rem]"
          subtextClassName={CARD_FC_PILL_CLASS}
        />
        {item.type ? <p className="text-base font-semibold text-ink">{item.type}</p> : null}
        {item.specList.length ? (
          <p className="flex flex-wrap items-center gap-3 text-[0.875rem] text-ink-70">
            {item.specList.map((spec) => <SpecItem key={spec.key} spec={spec} />)}
          </p>
        ) : null}
        {item.place ? (
          <p className="flex items-center gap-1.5 text-sm text-ink-45">
            <MapPin strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 flex-none" aria-hidden="true" />
            <span className="truncate">{item.place}</span>
          </p>
        ) : null}
        <span className="mt-4 hidden h-11 items-center gap-2 self-start rounded-lg bg-blue px-5 text-sm font-bold text-white transition-colors group-hover:bg-blue-deep md:inline-flex">
          {labels.featuredCta}
          <ArrowRight strokeWidth={2} className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}

function WhatsAppButton({ agent, labels, short = false, className = '' }) {
  if (!agent.whatsappHref) return null;
  return (
    <a
      href={agent.whatsappHref}
      target="_blank"
      rel="noopener noreferrer"
      className={`u-press flex items-center justify-center gap-2.5 rounded-lg bg-blue font-bold text-white transition-[background-color,translate] duration-150 hover:-translate-y-0.5 hover:bg-blue-deep ${className}`}
    >
      <WhatsAppIcon className="h-5 w-5 flex-none" />
      <span className="truncate">{short ? 'WhatsApp' : agent.whatsappIsCentral ? labels.whatsappCentralCta : labels.whatsappCta}</span>
    </a>
  );
}

function MessageButton({ agent, labels, short = false, className = '' }) {
  if (!agent.messageHref) return null;
  return (
    <Link
      href={agent.messageHref}
      aria-label={short ? labels.messageCta : undefined}
      className={`u-press flex items-center justify-center gap-2 rounded-lg font-semibold text-blue-deep ring-[1.5px] ring-inset ring-blue/40 transition-colors hover:bg-blue-tint ${className}`}
    >
      <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem] flex-none" aria-hidden="true" />
      {short ? null : labels.messageCta}
    </Link>
  );
}

function CallButton({ agent, labels, className = '' }) {
  if (!agent.telHref) return null;
  return (
    <a
      href={agent.telHref}
      className={`u-press flex items-center justify-center gap-2 rounded-lg font-semibold text-ink ring-[1.5px] ring-inset ring-ink transition-colors hover:bg-ink hover:text-white ${className}`}
    >
      <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem] flex-none" aria-hidden="true" />
      {labels.call}
    </a>
  );
}

export default function AgentProfileView({ agent, tabs, initialTab, labels, profileUrl, enquiry, enquiryOpen = false, children }) {
  const [tab, setTab] = useState(initialTab);
  const [sort, setSort] = useState('recent');
  const [bioOpen, setBioOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(enquiryOpen);
  const [toast, setToast] = useState(false);
  const toastTimer = useRef(null);
  // On a laptop the written enquiry is always open in the rail; on a phone
  // it is folded under the listings. Server render = phone (closed).
  const isDesktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP_QUERY).matches, () => false);

  const current = tabs.find((entry) => entry.key === tab) || tabs[0];
  const items = useMemo(() => sortItems(current.items, sort), [current, sort]);
  // The newest listing is featured only while the list is sorted newest
  // first — "Dernier bien publié" would be false under a price sort.
  const featured = sort === 'recent' ? items[0] : null;
  const rest = featured ? items.slice(1) : items;

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function pickTab(key) {
    setTab(key);
    // Keeps the tab in a shared link without a server round trip.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', key);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // A sandboxed frame may refuse replaceState; the tab still switches.
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard?.writeText(profileUrl);
    } catch {
      // Clipboard refused (insecure context, denied permission): say nothing false.
      return;
    }
    clearTimeout(toastTimer.current);
    setToast(true);
    toastTimer.current = setTimeout(() => setToast(false), 2400);
  }

  const communes = agent.communes || [];
  const bioLong = (agent.bio || '').length > BIO_CLAMP_CHARS;
  const showForm = isDesktop || formOpen;

  const communeChips = (
    <ul className="flex flex-wrap gap-2">
      {communes.map((commune) => (
        <li key={commune} className="inline-flex h-8 items-center rounded-full bg-blue-tint px-3.5 text-[0.8125rem] font-semibold text-blue-deep">
          {commune}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="overflow-x-clip bg-canvas pb-24 lg:pb-0">
      {/* Cover band. The photo is the agency's newest listing (page.js); the
          royal wash is the design system's --scrim-hero, so the white
          breadcrumb reads on any photo. No photo → the plain royal band. */}
      <div className="relative overflow-hidden border-b border-brass/50 bg-blue-deep">
        {agent.coverImage ? (
          <>
            <SafeImage src={agent.coverImage} alt="" fill priority sizes="100vw" className="object-cover" />
            <div aria-hidden="true" className="absolute inset-0 [background-image:var(--scrim-hero)]" />
            <div aria-hidden="true" className="absolute inset-0 bg-blue-900/25" />
          </>
        ) : null}
        <div className="relative mx-auto max-w-[77.5rem] px-4 pb-28 pt-4 lg:px-6 lg:pb-40 lg:pt-6">
          <Link
            href="/agents"
            className="u-glass-royal inline-flex h-9 items-center gap-1 rounded-full pl-2 pr-3.5 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-blue-900/60"
          >
            <ChevronLeft strokeWidth={2} className="h-4 w-4" aria-hidden="true" />
            {labels.agencies}
          </Link>
        </div>
      </div>

      {/* Identity card, overlapping the band. */}
      <div className="relative mx-auto max-w-[77.5rem] px-4 lg:px-6">
        <section
          aria-labelledby="agency-name"
          className="-mt-16 rounded-2xl bg-surface shadow-[0_24px_60px_-24px_rgba(12,29,80,0.35)] ring-1 ring-line/70 lg:-mt-28"
        >
          <div className="flex flex-col gap-3 px-5 pb-5 lg:flex-row lg:items-start lg:gap-8 lg:p-10">
            <div className="flex items-end justify-between lg:block">
              <div
                className={`-mt-10 grid h-[5.5rem] w-[5.5rem] flex-none place-items-center overflow-hidden rounded-[14px] shadow-md ring-4 ring-surface lg:mt-0 lg:h-32 lg:w-32 ${
                  agent.image ? 'bg-surface' : 'bg-blue-900'
                }`}
              >
                {agent.image ? (
                  <AgentAvatar src={agent.image} alt={agent.name} />
                ) : agent.initial ? (
                  <span aria-hidden="true" className="text-[2.75rem] font-bold leading-none text-white lg:text-6xl">{agent.initial}</span>
                ) : (
                  <Building2 strokeWidth={1.75} className="h-8 w-8 text-white/85" aria-hidden="true" />
                )}
              </div>
              <a
                href={agent.shareHref}
                target="_blank"
                rel="noopener noreferrer"
                className="u-press inline-flex h-11 items-center gap-2 rounded-full bg-blue-tint px-4 text-sm font-semibold text-blue-deep transition-colors hover:bg-blue/10 lg:hidden"
              >
                <Share2 strokeWidth={ICON_STROKE_WIDTH} className="h-[1.0625rem] w-[1.0625rem]" aria-hidden="true" />
                {labels.shareShort}
              </a>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-2.5 lg:pt-1">
              {agent.verifiedLabel || agent.upToDateLabel || agent.memberSince ? (
                <div className="flex flex-wrap gap-2">
                  {agent.verifiedLabel ? (
                    <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-brass-tint pl-2 pr-3 text-xs font-bold text-brass-deep">
                      <BadgeCheck strokeWidth={2} className="h-4 w-4 text-brass" aria-hidden="true" />
                      {agent.verifiedLabel}
                    </span>
                  ) : null}
                  {/* "Annonces à jour": every listing online confirmed or
                      published within the check's window (page.js decides). */}
                  {agent.upToDateLabel ? (
                    <span
                      title={agent.upToDateHint || undefined}
                      className="inline-flex h-7 items-center gap-1.5 rounded-full bg-success-tint pl-2.5 pr-3 text-xs font-bold text-success"
                    >
                      <CalendarCheck strokeWidth={2} className="h-3.5 w-3.5" aria-hidden="true" />
                      {agent.upToDateLabel}
                    </span>
                  ) : null}
                  {agent.memberSince ? (
                    <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-canvas-alt pl-2.5 pr-3 text-xs font-semibold text-ink-70">
                      <CalendarDays strokeWidth={2} className="h-3.5 w-3.5" aria-hidden="true" />
                      {agent.memberSince}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <h1 id="agency-name" className="break-words text-[1.875rem] font-bold leading-[1.1] tracking-tight text-ink lg:text-[2.75rem]">
                {agent.name}
              </h1>
              {agent.subline ? <p className="text-[0.9375rem] font-semibold text-ink-70 lg:text-base">{agent.subline}</p> : null}
              {agent.locationLine ? (
                <p className="flex items-center gap-1.5 text-[0.8125rem] text-ink-45 lg:text-sm">
                  <MapPin strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 flex-none" aria-hidden="true" />
                  <span className="truncate">{agent.locationLine}</span>
                </p>
              ) : null}
            </div>

            {/* From a laptop up the contact actions sit in the card, where a
                desktop visitor looks for them; the pinned bar is a phone pattern. */}
            <div className="hidden w-[20rem] flex-none flex-col gap-2.5 pt-1 lg:flex">
              <WhatsAppButton agent={agent} labels={labels} className="h-[3.25rem] px-4 text-[0.9375rem]" />
              {agent.whatsappIsCentral ? <p className="text-[0.8125rem] leading-snug text-ink-45">{labels.centralNote}</p> : null}
              <MessageButton agent={agent} labels={labels} className="h-12 px-4 text-sm" />
              <div className="flex gap-2.5">
                <CallButton agent={agent} labels={labels} className="h-12 flex-1 text-sm" />
                <button
                  type="button"
                  onClick={copyLink}
                  aria-label={labels.copyLink}
                  title={labels.copyLink}
                  className={`u-press grid h-12 place-items-center rounded-full text-blue-deep ring-1 ring-inset ring-line transition-colors hover:bg-blue-tint ${agent.telHref ? 'w-12 flex-none' : 'flex-1'}`}
                >
                  <Link2 strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
                </button>
              </div>
              <a
                href={agent.shareHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-blue-deep transition-colors hover:bg-blue-tint"
              >
                <Share2 strokeWidth={ICON_STROKE_WIDTH} className="h-[1.0625rem] w-[1.0625rem]" aria-hidden="true" />
                {labels.shareCta}
              </a>
            </div>
          </div>

          {/* Figures, all facts: live listings, communes covered, and — from
              the first one — listings let or sold (a count, never a price). */}
          <dl className={`grid border-t border-line/70 ${STAT_GRID_COLS[1 + (communes.length ? 1 : 0) + (labels.closedCountLabel ? 1 : 0)]}`}>
            <div className="flex flex-col gap-0.5 px-5 py-4 lg:px-10 lg:py-5">
              <dt className="sr-only">{labels.liveCountLabel}</dt>
              <dd className="u-tabular text-[1.375rem] font-extrabold leading-tight tracking-tight text-ink lg:text-[1.875rem]">{labels.liveCount}</dd>
              <dd className="text-xs text-ink-45 lg:text-[0.8125rem]">{labels.liveCountLabel}</dd>
            </div>
            {communes.length ? (
              <div className="flex min-w-0 flex-col gap-0.5 border-l border-line/70 px-5 py-4 lg:px-10 lg:py-5">
                <dt className="sr-only">{labels.communesLabel}</dt>
                <dd className="u-tabular text-[1.375rem] font-extrabold leading-tight tracking-tight text-ink lg:text-[1.875rem]">{agent.communesCount}</dd>
                <dd className="text-xs text-ink-45 lg:truncate lg:text-[0.8125rem]">
                  <span className="lg:hidden">{labels.communesCountLabel}</span>
                  <span className="hidden lg:inline">{communes.join(', ')}</span>
                </dd>
              </div>
            ) : null}
            {labels.closedCountLabel ? (
              <div className="flex min-w-0 flex-col gap-0.5 border-l border-line/70 px-5 py-4 lg:px-10 lg:py-5">
                <dt className="sr-only">{labels.closedCountLabel}</dt>
                <dd className="u-tabular text-[1.375rem] font-extrabold leading-tight tracking-tight text-ink lg:text-[1.875rem]">{labels.closedCount}</dd>
                <dd className="text-xs text-ink-45 lg:text-[0.8125rem]">{labels.closedCountLabel}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        {communes.length ? <div className="mt-5 lg:hidden">{communeChips}</div> : null}
      </div>

      <div className="mx-auto max-w-[77.5rem] px-4 pt-8 lg:flex lg:items-start lg:gap-10 lg:px-6 lg:pt-14">
        <div className="flex min-w-0 flex-1 flex-col gap-10 lg:gap-16">
          {agent.bio ? (
            <section className="flex max-w-[45rem] flex-col gap-2">
              <span className="u-eyebrow text-blue">{labels.about}</span>
              <p className={`whitespace-pre-line text-base leading-relaxed text-ink-70 lg:text-[1.0625rem] ${bioLong && !bioOpen ? 'line-clamp-3' : ''}`}>
                {agent.bio}
              </p>
              {bioLong ? (
                <button
                  type="button"
                  onClick={() => setBioOpen((v) => !v)}
                  aria-expanded={bioOpen}
                  className="min-h-11 self-start text-sm font-semibold text-blue underline underline-offset-[3px] hover:text-blue-deep"
                >
                  {bioOpen ? labels.readLess : labels.readMore}
                </button>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby="agency-listings" className="flex flex-col gap-5 lg:gap-7">
            <div className="flex flex-col gap-3 border-b border-line/70 lg:gap-4">
              <h2 id="agency-listings" className="text-[1.625rem] font-bold leading-tight tracking-tight text-ink lg:text-[2.125rem]">
                {labels.listingsHeading}
              </h2>
              <div className="flex items-end justify-between gap-3">
                <div className="flex gap-6 lg:gap-8" role="tablist">
                  {tabs.map((entry) => {
                    const active = entry.key === current.key;
                    return (
                      <button
                        key={entry.key}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => pickTab(entry.key)}
                        className={`-mb-px min-h-11 border-b-[3px] pb-2.5 text-[0.9375rem] font-bold transition-colors ${
                          active ? 'border-blue text-ink' : 'border-transparent text-ink-45 hover:text-ink-70'
                        }`}
                      >
                        {entry.label} <span className="u-tabular font-medium text-ink-45">({entry.items.length})</span>
                      </button>
                    );
                  })}
                </div>
                {items.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setSort((s) => SORTS[(SORTS.indexOf(s) + 1) % SORTS.length])}
                    className="u-press mb-2 inline-flex h-9 flex-none items-center gap-1.5 rounded-full bg-surface px-3.5 text-[0.8125rem] font-semibold text-ink ring-1 ring-inset ring-line hover:bg-blue-tint"
                  >
                    <ArrowUpDown strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
                    {labels.sorts[sort]}
                  </button>
                ) : null}
              </div>
            </div>

            {items.length ? (
              <>
                {featured ? <FeaturedCard key={`${current.key}-${featured.id}`} item={featured} labels={labels} /> : null}
                {rest.length ? (
                  <ul className="grid gap-4 sm:grid-cols-2 lg:gap-6">
                    {rest.map((item) => (
                      <li key={item.id}>
                        <ListingCard item={item} labels={labels} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <div className="flex flex-col items-center gap-2.5 px-8 pb-6 pt-8 text-center">
                <div className="mb-1.5 grid h-14 w-14 place-items-center rounded-full bg-blue-tint text-blue">
                  <Bell strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6" aria-hidden="true" />
                </div>
                <p className="text-base font-bold text-ink">{current.emptyTitle}</p>
                <p className="max-w-[30ch] text-sm leading-relaxed text-ink-45">{labels.emptyBody}</p>
                {current.alertHref ? (
                  <a
                    href={current.alertHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="u-press mt-2 inline-flex h-11 items-center gap-2 rounded-lg px-[1.125rem] text-sm font-semibold text-ink ring-[1.5px] ring-inset ring-ink transition-colors hover:bg-ink hover:text-white"
                  >
                    <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
                    {labels.emptyCta}
                  </a>
                ) : null}
              </div>
            )}
          </section>

          {children}
        </div>

        {/* The contact rail on a laptop; on a phone it follows the listings. */}
        <aside className="mt-10 flex flex-col gap-5 lg:sticky lg:top-6 lg:mt-0 lg:w-[22.5rem] lg:flex-none">
          <div className="hidden flex-col gap-4 rounded-2xl bg-surface p-6 ring-1 ring-line/70 lg:flex">
            <p className="text-[1.0625rem] font-bold text-ink">{labels.contactCardTitle}</p>
            {agent.contactName ? (
              <div className="flex items-center gap-3.5">
                <span aria-hidden="true" className="grid h-12 w-12 flex-none place-items-center rounded-full bg-blue-tint text-[0.9375rem] font-bold text-blue-deep">
                  {agent.contactInitials}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-base font-bold text-ink">{agent.contactName}</p>
                  <p className="truncate text-[0.8125rem] text-ink-45">{labels.contactRole}</p>
                </div>
              </div>
            ) : null}
            <WhatsAppButton agent={agent} labels={labels} className="h-12 px-4 text-sm" />
            <CallButton agent={agent} labels={labels} className="h-12 text-sm" />
          </div>

          <div className="rounded-2xl bg-surface ring-1 ring-line/70">
            <p className="hidden px-6 pb-4 pt-6 text-[1.0625rem] font-bold text-ink lg:block">{labels.writeToAgency}</p>
            <button
              type="button"
              onClick={() => setFormOpen((v) => !v)}
              aria-expanded={showForm}
              className="flex min-h-14 w-full items-center justify-between gap-3 px-5 text-left text-[0.9375rem] font-semibold text-ink lg:hidden"
            >
              {labels.writeToAgency}
              <ChevronDown
                strokeWidth={ICON_STROKE_WIDTH}
                className={`h-[1.125rem] w-[1.125rem] flex-none transition-transform ${showForm ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
            {showForm ? <div className="px-5 pb-5 lg:px-6 lg:pb-6">{enquiry}</div> : null}
          </div>

          {communes.length ? (
            <div className="hidden flex-col gap-3.5 rounded-2xl bg-surface p-6 ring-1 ring-line/70 lg:flex">
              <span className="u-eyebrow">{labels.zonesLabel}</span>
              {communeChips}
            </div>
          ) : null}
        </aside>
      </div>

      {/* Alert band: a pre-written WhatsApp asking the agency to say when a
          matching property comes in (page.js). The agency answers it. */}
      {agent.alertHref ? (
        <div className="mx-auto max-w-[77.5rem] px-4 pb-10 pt-10 lg:px-6 lg:pb-24 lg:pt-16">
          <section
            aria-labelledby="agency-alert"
            className="flex flex-col gap-5 rounded-2xl bg-blue-deep p-6 lg:flex-row lg:items-center lg:justify-between lg:gap-10 lg:px-14 lg:py-12"
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-6">
              <span aria-hidden="true" className="grid h-12 w-12 flex-none place-items-center rounded-full bg-blue-900 text-white lg:h-14 lg:w-14">
                <Bell strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6" />
              </span>
              <div className="flex flex-col gap-2">
                <h2 id="agency-alert" className="text-[1.5rem] font-bold leading-tight tracking-tight text-white lg:text-[2rem]">
                  {labels.alertTitle}
                </h2>
                <p className="max-w-[36rem] text-[0.9375rem] leading-relaxed text-white/80 lg:text-base">{labels.alertBody}</p>
              </div>
            </div>
            <a
              href={agent.alertHref}
              target="_blank"
              rel="noopener noreferrer"
              className="u-press flex h-[3.25rem] flex-none items-center justify-center gap-2.5 rounded-lg bg-white px-6 text-[0.9375rem] font-bold text-blue-deep transition-colors hover:bg-blue-tint"
            >
              <WhatsAppIcon className="h-5 w-5" />
              {labels.alertCta}
            </a>
          </section>
        </div>
      ) : null}

      {/* Pinned contact bar on a phone: WhatsApp (royal, the only action
          colour) and the call outlined. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-surface pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_28px_-16px_rgba(12,29,80,0.25)] lg:hidden">
        <div className="mx-auto flex max-w-[40rem] items-center gap-2.5 px-4">
          {agent.whatsappHref ? (
            <WhatsAppButton agent={agent} labels={labels} short className="h-[3.25rem] flex-[1.4] px-3 text-[0.9375rem]" />
          ) : (
            <span className="flex h-[3.25rem] flex-1 items-center justify-center rounded-lg px-4 text-center text-[0.8125rem] text-ink-45 ring-1 ring-inset ring-line">
              {labels.contactUnavailable}
            </span>
          )}
          <CallButton agent={agent} labels={labels} className="h-[3.25rem] flex-1 text-[0.9375rem]" />
          <MessageButton agent={agent} labels={labels} short className="h-[3.25rem] w-[3.25rem] flex-none" />
        </div>
      </div>

      <div
        role="status"
        className={`pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center transition-opacity duration-200 lg:bottom-8 ${toast ? 'opacity-100' : 'opacity-0'}`}
      >
        {toast ? (
          <span className="rounded-full bg-ink px-4 py-2 text-[0.8125rem] font-semibold text-white shadow-md">{labels.linkCopied}</span>
        ) : null}
      </div>
    </div>
  );
}
