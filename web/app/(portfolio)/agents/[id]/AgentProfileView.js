'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpDown, BadgeCheck, Bell, Building2, ChevronDown, ChevronUp, Link2, MapPin, MessageCircle, Phone, Sparkles, Star } from 'lucide-react';
import AgentAvatar from '@/components/AgentAvatar';
import CardImageCarousel from '@/components/CardImageCarousel';
import Price from '@/components/Price';
import FavoriteButton from '@/components/FavoriteButton';
import SpecItem from '@/components/SpecItem';
import { Badge } from '@/components/ListingBadges';
import { WhatsAppIcon } from '@/components/WhatsAppCTA';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The public agent profile, laid out like a portal's branch page (owner's
 * reference, 2026-11-04: Rightmove's agent page): a white header with the
 * agency's logo centred, its name, where it works and what it says about
 * itself; then its listings as full-width cards; then a pinned two-button
 * contact bar (WhatsApp + call — no e-mail, Lukka Place does not use it).
 *
 * A card is a link to the listing page, photo included, so a visitor moves
 * on into the site from here rather than staying in an overlay. Booking a
 * visit, entry costs and the map all live on that page.
 *
 * Everything shown is decided on the server (page.js): which number is
 * called (only a verified, routable one), the "Nouveau" flag (the database
 * clock's is_fresh) and "Réservé" (listing_status under_offer). Price, place,
 * type and specs use PropertyCard's sizes, weights, <SpecItem> icons and
 * <Badge> pills, so a listing reads the same here as in the search results.
 */
const SORTS = ['recent', 'priceAsc', 'priceDesc'];
const COMMUNES_SHOWN = 2;
// A description longer than this is clamped to three lines with "Lire la suite".
const BIO_CLAMP_CHARS = 160;

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

/**
 * One listing: a link to its page, photo first, PropertyCard's type. The
 * photos still swipe: CardImageCarousel is a scroll strip, and a swipe is a
 * scroll, not a click, so it never navigates.
 *
 * Press feedback is PropertyCard's, not `.u-press`: no shrink while the press
 * is on the photo strip or a button. Scaling the strip's ancestor as a finger
 * lands is how iOS Safari drops the swipe (CardImageCarousel's
 * `data-card-photo`) — `.u-press` here made the photos un-swipeable on iPhone.
 */
function ListingCard({ item, labels }) {
  return (
    <Link
      href={item.href}
      className="group block h-full overflow-hidden rounded-2xl border border-line/70 bg-surface shadow-sm transition-[box-shadow,scale] duration-150 hover:shadow-md [&:active:not(:has(button:active)):not(:has([data-card-photo]:active))]:scale-[0.985]"
    >
      <div className="relative aspect-[3/2] w-full overflow-hidden bg-canvas-alt">
        {item.photos.length ? (
          <CardImageCarousel images={item.photos} alt={item.title} sizes="(min-width: 1024px) 400px, (min-width: 768px) 360px, 100vw" />
        ) : null}
        {item.isNew || item.reserved ? (
          <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
            <Badges item={item} labels={labels} />
          </div>
        ) : null}
        {/* FavoriteButton cancels the link's navigation itself, as on PropertyCard. */}
        <div className="absolute right-3 top-3 z-10">
          <FavoriteButton listingId={item.id} price={item.price} commune={item.commune} />
        </div>
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
        {/* Type on the left, specs on the right, as on the reference card. */}
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

export default function AgentProfileView({ agent, tabs, initialTab, labels, profileUrl, children }) {
  const [tab, setTab] = useState(initialTab);
  const [sort, setSort] = useState('recent');
  const [communesOpen, setCommunesOpen] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const [toast, setToast] = useState(false);
  const toastTimer = useRef(null);

  const current = tabs.find((entry) => entry.key === tab) || tabs[0];
  const items = useMemo(() => sortItems(current.items, sort), [current, sort]);

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
  const communesSummary = communes.length
    ? communes.slice(0, COMMUNES_SHOWN).join(', ') + (communes.length > COMMUNES_SHOWN ? ` +${communes.length - COMMUNES_SHOWN}` : '')
    : null;
  const bioLong = (agent.bio || '').length > BIO_CLAMP_CHARS;

  return (
    // A compact white header strip (logo beside name, one line of contact,
    // one row of stats), then the listings on the mist ground (owner's
    // direction, 2026-11-04: the centred-logo card read as amateurish).
    <div className="overflow-x-clip bg-canvas-deep pb-10">
      <div className="border-b border-line/70 bg-surface">
        <div className="mx-auto max-w-[40rem] px-4 pt-5 md:max-w-3xl lg:max-w-[77.5rem] lg:px-6 lg:pt-8">
          <div className="flex items-center gap-3.5 lg:gap-6">
            <div
              className={`grid h-16 w-16 flex-none place-items-center overflow-hidden rounded-xl ring-1 ring-line/60 lg:h-24 lg:w-24 lg:rounded-2xl ${
                agent.image ? 'bg-surface' : 'bg-gradient-to-br from-blue-900 to-blue'
              }`}
            >
              {agent.image ? (
                <AgentAvatar src={agent.image} alt={agent.name} />
              ) : agent.initial ? (
                <span className="text-xl font-bold leading-none text-white lg:text-[2rem]">{agent.initial}</span>
              ) : (
                <Building2 strokeWidth={1.75} className="h-6 w-6 text-white/85" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-1.5 text-xl font-bold leading-tight tracking-tight text-ink lg:text-[1.875rem]">
                <span className="line-clamp-2 min-w-0 break-words">{agent.name}</span>
                {agent.verifiedLabel ? (
                  <BadgeCheck strokeWidth={2.25} className="h-[1.125rem] w-[1.125rem] flex-none text-blue" aria-label={agent.verifiedLabel} />
                ) : null}
              </h1>
              {agent.subline ? <p className="mt-0.5 truncate text-[0.8125rem] font-medium text-ink-70 lg:mt-1.5 lg:text-[0.9375rem]">{agent.subline}</p> : null}
              {agent.locationLine ? (
                <p className="mt-0.5 flex items-center gap-1 text-[0.8125rem] text-ink-45 lg:text-sm">
                  <MapPin strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
                  <span className="truncate">{agent.locationLine}</span>
                </p>
              ) : null}
            </div>
            {/* From a laptop up the contact actions sit in the header, where a
                desktop visitor looks for them; the pinned bar is a phone pattern. */}
            <div className="hidden flex-none items-center gap-3 lg:flex">
              {agent.whatsappHref ? (
                <a
                  href={agent.whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="u-press inline-flex h-11 items-center gap-2 rounded-xl bg-green px-5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-green-deep"
                >
                  <WhatsAppIcon className="h-[1.125rem] w-[1.125rem]" />
                  WhatsApp
                </a>
              ) : null}
              {agent.telHref ? (
                <a
                  href={agent.telHref}
                  className="u-press inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-bold text-blue-deep ring-[1.5px] ring-inset ring-blue-deep transition-colors hover:bg-blue-tint"
                >
                  <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
                  {labels.call}
                </a>
              ) : null}
            </div>
          </div>

          <div className="mt-3.5 flex items-center gap-2 lg:mt-5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs">
              <span className="rounded-full bg-canvas-deep px-2.5 py-1 font-semibold text-ink-70">{labels.activeCount}</span>
              {agent.rating ? (
                <a href="#avis" className="inline-flex items-center gap-1 rounded-full bg-canvas-deep px-2.5 py-1 font-semibold text-ink-70 hover:text-ink">
                  <Star strokeWidth={ICON_STROKE_WIDTH} className="h-3 w-3 fill-warning text-warning" aria-hidden="true" />
                  {agent.rating}
                </a>
              ) : null}
              {communesSummary ? (
                <button
                  type="button"
                  onClick={() => setCommunesOpen((v) => !v)}
                  aria-expanded={communesOpen}
                  aria-label={`${labels.communesLabel} ${communes.join(', ')}`}
                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-canvas-deep px-2.5 py-1 font-semibold text-ink-70 hover:text-ink"
                >
                  <span className="truncate">{communesSummary}</span>
                  {communesOpen ? <ChevronUp className="h-3 w-3 flex-none" /> : <ChevronDown className="h-3 w-3 flex-none" />}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={copyLink}
              aria-label={labels.copyLink}
              title={labels.copyLink}
              className="u-press grid h-9 w-9 flex-none place-items-center rounded-full text-ink-70 transition-colors hover:bg-canvas-deep hover:text-ink"
            >
              <Link2 strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
            </button>
          </div>
          {communesOpen ? (
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-70">
              <span className="font-semibold text-ink">{labels.communesLabel}</span> {communes.join(', ')}
            </p>
          ) : null}

          {agent.bio ? (
            <div className="mt-3">
              <p className={`max-w-[70ch] whitespace-pre-line text-sm leading-relaxed text-ink-70 ${bioLong && !bioOpen ? 'line-clamp-2' : ''}`}>
                {agent.bio}
              </p>
              {bioLong ? (
                <button
                  type="button"
                  onClick={() => setBioOpen((v) => !v)}
                  aria-expanded={bioOpen}
                  className="mt-0.5 text-sm font-semibold text-blue underline-offset-2 hover:underline"
                >
                  {bioOpen ? labels.readLess : labels.readMore}
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Underlined tabs on the strip's bottom edge, flush with the feed. */}
          <div className="mt-3 flex gap-6 lg:mt-5 lg:gap-8" role="tablist">
            {tabs.map((entry) => {
              const active = entry.key === current.key;
              return (
                <button
                  key={entry.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => pickTab(entry.key)}
                  className={`-mb-px border-b-2 pb-3 pt-2 text-sm font-semibold transition-colors lg:text-[0.9375rem] ${
                    active ? 'border-blue text-ink' : 'border-transparent text-ink-45 hover:text-ink-70'
                  }`}
                >
                  {entry.label} <span className="u-tabular font-medium text-ink-45">({entry.items.length})</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[40rem] md:max-w-3xl lg:max-w-[77.5rem] lg:px-2">
        {items.length ? (
          <>
            <div className="flex items-center justify-between px-5 pb-3 pt-5 lg:px-4 lg:pb-4 lg:pt-6">
              <h2 className="text-[0.8125rem] font-medium text-ink-45">{current.countLabel}</h2>
              <button
                type="button"
                onClick={() => setSort((s) => SORTS[(SORTS.indexOf(s) + 1) % SORTS.length])}
                className="u-press inline-flex h-[2.125rem] items-center gap-1.5 rounded-full bg-surface px-3 text-[0.8125rem] font-semibold text-ink ring-1 ring-inset ring-line hover:bg-canvas-alt"
              >
                <ArrowUpDown strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                {labels.sorts[sort]}
              </button>
            </div>
            {/* One column on a phone, a grid from a tablet up. */}
            <ul className="flex flex-col gap-4 px-4 md:grid md:grid-cols-2 lg:grid-cols-3 lg:gap-6">
              {items.map((item) => (
                <li key={item.id}>
                  <ListingCard item={item} labels={labels} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="mt-5 flex flex-col items-center gap-2.5 border-t border-line/60 px-8 pb-6 pt-12 text-center">
            <div className="mb-1.5 grid h-14 w-14 place-items-center rounded-full bg-blue-tint text-blue">
              <Bell strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6" />
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
                <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
                {labels.emptyCta}
              </a>
            ) : null}
          </div>
        )}

        {children}
      </div>

      {/* Pinned contact bar on the brand's dark blue, two labelled buttons:
          WhatsApp in the green the listing page uses, call outlined. */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-blue-deep pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(12,29,80,0.18)] lg:hidden">
        <div className="mx-auto flex max-w-[40rem] items-center gap-3 px-4">
          {agent.whatsappHref ? (
            <a
              href={agent.whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="u-press flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-green text-[0.9375rem] font-bold text-white shadow-sm transition-colors hover:bg-green-deep"
            >
              <WhatsAppIcon className="h-[1.125rem] w-[1.125rem]" />
              WhatsApp
            </a>
          ) : (
            <span className="flex h-12 flex-1 items-center justify-center rounded-xl px-4 text-center text-[0.8125rem] text-white/75 ring-1 ring-inset ring-white/30">
              {labels.contactUnavailable}
            </span>
          )}
          {agent.telHref ? (
            <a
              href={agent.telHref}
              className="u-press flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-[0.9375rem] font-bold text-white ring-[1.5px] ring-inset ring-white/70 transition-colors hover:bg-white/10"
            >
              <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
              {labels.call}
            </a>
          ) : null}
        </div>
      </div>

      <div
        role="status"
        className={`pointer-events-none fixed inset-x-0 bottom-24 z-[60] lg:bottom-8 flex justify-center transition-opacity duration-200 ${toast ? 'opacity-100' : 'opacity-0'}`}
      >
        {toast ? (
          <span className="rounded-full bg-ink px-4 py-2 text-[0.8125rem] font-semibold text-white shadow-md">{labels.linkCopied}</span>
        ) : null}
      </div>
    </div>
  );
}
