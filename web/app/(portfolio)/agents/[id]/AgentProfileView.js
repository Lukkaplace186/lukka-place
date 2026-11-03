'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpDown, BadgeCheck, Bell, ChevronDown, ChevronUp, Link2, MapPin, MessageCircle, Phone, Sparkles, Star } from 'lucide-react';
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

/** One listing: a link to its page, photo first, PropertyCard's type. */
function ListingCard({ item, labels }) {
  return (
    <Link
      href={item.href}
      className="u-press group block overflow-hidden rounded-2xl border border-line/70 bg-surface shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-[3/2] w-full overflow-hidden bg-canvas-alt">
        {item.photos.length ? (
          <CardImageCarousel images={item.photos} alt={item.title} sizes="(min-width: 640px) 600px, 100vw" />
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
    <div className="overflow-x-clip pb-10">
      {/* Header: white, the agency's logo centred, then who and where. */}
      <div className="mx-auto max-w-[40rem] px-5 pt-4">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={copyLink}
            className="u-press inline-flex h-8 items-center gap-1.5 rounded-full bg-canvas-alt px-3 text-xs font-semibold text-ink ring-1 ring-inset ring-line/60 transition-colors hover:bg-surface"
          >
            <Link2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
            {labels.copyLink}
          </button>
        </div>

        <div className="mt-2 flex justify-center">
          <div className="grid h-28 w-28 place-items-center overflow-hidden rounded-2xl bg-canvas-alt shadow-sm ring-1 ring-line/70">
            {agent.image ? (
              <AgentAvatar src={agent.image} alt={agent.name} />
            ) : agent.initial ? (
              <span className="text-[2.25rem] font-bold leading-none text-ink-45">{agent.initial}</span>
            ) : (
              <span className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-45">{labels.logo}</span>
            )}
          </div>
        </div>

        <h1 className="mt-5 flex items-center gap-1.5 text-[1.625rem] font-bold leading-[1.15] tracking-tight text-ink">
          <span className="min-w-0 break-words">{agent.name}</span>
          {agent.verifiedLabel ? (
            <BadgeCheck strokeWidth={2.25} className="h-5 w-5 flex-none text-blue" aria-label={agent.verifiedLabel} />
          ) : null}
        </h1>
        {agent.locationLine ? (
          <p className="mt-1.5 flex items-start gap-1.5 text-[0.9375rem] text-ink-70">
            <MapPin strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 flex-none text-ink-45" aria-hidden="true" />
            {agent.locationLine}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.8125rem]">
          {agent.verifiedLabel ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-tint px-3 py-1.5 font-semibold text-blue-deep">
              <BadgeCheck strokeWidth={2.25} className="h-3.5 w-3.5" aria-hidden="true" />
              {agent.verifiedLabel}
            </span>
          ) : null}
          <span className="rounded-full bg-canvas-alt px-3 py-1.5 font-semibold text-ink ring-1 ring-inset ring-line/60">
            {labels.activeCount}
          </span>
          {agent.rating ? (
            <a
              href="#avis"
              className="inline-flex items-center gap-1 rounded-full bg-canvas-alt px-3 py-1.5 font-semibold text-ink ring-1 ring-inset ring-line/60 hover:bg-surface"
            >
              <Star strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 fill-warning text-warning" aria-hidden="true" />
              {agent.rating}
            </a>
          ) : null}
        </div>

        {agent.subline ? <p className="mt-4 text-[0.9375rem] font-bold text-ink">{agent.subline}</p> : null}

        {agent.bio ? (
          <div className="mt-1.5">
            <p className={`whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-70 ${bioLong && !bioOpen ? 'line-clamp-3' : ''}`}>
              {agent.bio}
            </p>
            {bioLong ? (
              <button
                type="button"
                onClick={() => setBioOpen((v) => !v)}
                aria-expanded={bioOpen}
                className="mt-1 text-[0.9375rem] font-semibold text-blue underline-offset-2 hover:underline"
              >
                {bioOpen ? labels.readLess : labels.readMore}
              </button>
            ) : null}
          </div>
        ) : null}

        {communesSummary ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setCommunesOpen((v) => !v)}
              aria-expanded={communesOpen}
              className="inline-flex items-center gap-1 text-[0.8125rem] text-ink-70"
            >
              <span className="font-semibold text-ink">{labels.communesLabel}</span>
              <span className="font-semibold text-blue-deep">{communesSummary}</span>
              {communesOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {communesOpen ? (
              <div className="mt-2 rounded-[10px] bg-canvas-alt px-3 py-2.5 text-[0.8125rem] leading-relaxed text-ink-70">
                {communes.join(', ')}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 flex rounded-full bg-canvas-alt p-1 ring-1 ring-inset ring-line/60" role="tablist">
          {tabs.map((entry) => {
            const active = entry.key === current.key;
            return (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => pickTab(entry.key)}
                className={`h-10 flex-1 rounded-full text-sm font-bold transition-colors ${
                  active ? 'bg-surface text-ink shadow-sm' : 'text-ink-45'
                }`}
              >
                {entry.label} ({entry.items.length})
              </button>
            );
          })}
        </div>
      </div>

      <div className="mx-auto max-w-[40rem]">
        {items.length ? (
          <>
            <div className="flex items-center justify-between px-5 pb-3 pt-5">
              <h2 className="text-base font-bold text-ink">{current.heading}</h2>
              <button
                type="button"
                onClick={() => setSort((s) => SORTS[(SORTS.indexOf(s) + 1) % SORTS.length])}
                className="u-press inline-flex h-[2.125rem] items-center gap-1.5 rounded-full bg-surface px-3 text-[0.8125rem] font-semibold text-ink ring-1 ring-inset ring-line hover:bg-canvas-alt"
              >
                <ArrowUpDown strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                {labels.sorts[sort]}
              </button>
            </div>
            <ul className="flex flex-col gap-4 px-4">
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
      <div className="fixed inset-x-0 bottom-0 z-30 bg-blue-deep pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(12,29,80,0.18)]">
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
        className={`pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center transition-opacity duration-200 ${toast ? 'opacity-100' : 'opacity-0'}`}
      >
        {toast ? (
          <span className="rounded-full bg-ink px-4 py-2 text-[0.8125rem] font-semibold text-white shadow-md">{labels.linkCopied}</span>
        ) : null}
      </div>
    </div>
  );
}
