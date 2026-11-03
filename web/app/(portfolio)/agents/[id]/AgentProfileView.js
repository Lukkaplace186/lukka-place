'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpDown, BadgeCheck, Bell, CalendarClock, ChevronDown, ChevronRight, ChevronUp, Link2, MessageCircle, Phone, Sparkles, Star, X,
} from 'lucide-react';
import { Wordmark } from '@/components/Brand';
import AgentAvatar from '@/components/AgentAvatar';
import CardImageCarousel from '@/components/CardImageCarousel';
import Price from '@/components/Price';
import FavoriteButton from '@/components/FavoriteButton';
import VisitRequestDialog from '@/components/VisitRequestDialog';
import AddToVisitCartButton from '@/components/AddToVisitCartButton';
import SpecItem from '@/components/SpecItem';
import { Badge } from '@/components/ListingBadges';
import { trackCallClick, trackLeadClick } from '@/lib/analyticsClient';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The public agent profile, cloned from Claude Design's "Agent Profile
 * Mobile" 5a (2026-11-03): a royal band cut by the agency logo, a two-tab
 * segmented control, a compact list of rows with swipeable thumbnails, a
 * listing sheet that slides up instead of leaving the page, a slim royal bar
 * once the header has scrolled away, and a pinned contact bar.
 *
 * Everything shown is decided on the server (page.js) and handed over as
 * plain data: which number is called (only a verified, routable one), each
 * row's WhatsApp link (lib/leadRouting.js, the storefront's own message so
 * the engine still recognises the enquiry by its link), the "Nouveau" flag
 * (the database clock's is_fresh) and "Réservé" (listing_status under_offer).
 * This component only arranges, sorts and opens.
 *
 * Price, place, type, specs and badges are set exactly as PropertyCard sets
 * them (same sizes, weights, <SpecItem> icons and <Badge> pills), so a
 * listing reads the same here as in the search results.
 *
 * Two lines of the design were not carried over because nothing measures
 * them: "Répond en général dans l'heure" (no response-time figure exists for
 * a direct chat) — the bar says whether the number is verified instead.
 */
const SORTS = ['recent', 'priceAsc', 'priceDesc'];
const COMMUNES_SHOWN = 2;

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

/** PropertyCard's mobile spec line: type in medium, then icon specs. */
function TypeAndSpecs({ item }) {
  if (!item.type && !item.specList.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.875rem] text-ink">
      {item.type ? <span className="font-medium">{item.type}</span> : null}
      {item.specList.map((spec) => <SpecItem key={spec.key} spec={spec} />)}
    </div>
  );
}

export default function AgentProfileView({ agent, tabs, initialTab, labels, profileUrl, profilePath, visitNotice, children }) {
  const [tab, setTab] = useState(initialTab);
  const [sort, setSort] = useState('recent');
  const [communesOpen, setCommunesOpen] = useState(false);
  const [slim, setSlim] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [toast, setToast] = useState(false);
  // The listing the visit dialog is open for. Kept apart from the sheet's
  // selection so the dialog can stay open over (or after) the sheet.
  const [visitFor, setVisitFor] = useState(null);
  const headerRef = useRef(null);
  const toastTimer = useRef(null);

  const current = tabs.find((entry) => entry.key === tab) || tabs[0];
  const items = useMemo(() => sortItems(current.items, sort), [current, sort]);
  const allItems = useMemo(() => tabs.flatMap((entry) => entry.items), [tabs]);
  const selected = selectedId == null ? null : allItems.find((item) => item.id === selectedId) || null;

  // The slim bar appears once the logo and name have left the screen.
  useEffect(() => {
    const node = headerRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setSlim(!entry.isIntersecting), { threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // While the sheet is open: Escape closes it and the page behind stays put.
  // While the visit dialog is open over it, Escape is the dialog's (Radix):
  // closing both at once would drop the visitor back on the list.
  useEffect(() => {
    if (!selected) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"][data-state="open"]')) setSelectedId(null); };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [selected]);

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

  function open(item) {
    setPhotoIndex(0);
    setSelectedId(item.id);
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

  const logo = (sizeClass, ringClass) => (
    <div className={`grid flex-none place-items-center overflow-hidden bg-canvas-alt ${sizeClass} ${ringClass}`}>
      {agent.image ? (
        <AgentAvatar src={agent.image} alt={agent.name} />
      ) : agent.initial ? (
        <span className="text-[1.75rem] font-bold leading-none text-ink-45">{agent.initial}</span>
      ) : (
        <span className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-ink-45">{labels.logo}</span>
      )}
    </div>
  );

  return (
    <div className="overflow-x-clip pb-10">
      {/* Slim bar: logo + name only (design round 4), once the header is gone. */}
      <div
        aria-hidden={!slim}
        className={`fixed inset-x-0 top-0 z-40 bg-blue-deep transition-[opacity,transform] duration-200 ease-[cubic-bezier(.2,.7,.3,1)] lg:top-[4.75rem] ${
          slim ? 'opacity-100' : 'pointer-events-none -translate-y-1.5 opacity-0'
        }`}
      >
        <div className="mx-auto flex h-14 max-w-[40rem] items-center gap-2.5 px-4">
          {logo('h-8 w-8 rounded-lg', 'ring-2 ring-white')}
          <span className="truncate text-[0.9375rem] font-bold text-white">{agent.name}</span>
          {agent.verifiedLabel ? (
            <BadgeCheck strokeWidth={2.25} className="h-4 w-4 flex-none text-blue-tint" aria-label={agent.verifiedLabel} />
          ) : null}
        </div>
      </div>

      {/* Royal band: the Lukka Place logo and copy-link row, then ONE
          identity row (agency logo beside name and contact line, the slim
          bar's arrangement), and it ends there (owner's direction,
          2026-11-03). The name and its contact person stay on one ground —
          splitting them across the band's edge read as awkward — and no
          row is a logo alone with empty blue beside it. On a phone the band
          is the page's header: the layout's white header is hidden there.
          Description, stats, tabs and listings sit on the light ground. */}
      <div className="bg-blue-deep text-white">
        <div className="mx-auto max-w-[40rem]">
          <div className="flex items-start justify-between px-4 pt-3.5">
            <Wordmark inverted className="lg:invisible" />
            <button
              type="button"
              onClick={copyLink}
              className="u-press inline-flex h-8 items-center gap-1.5 rounded-full bg-white/[0.14] px-3 text-xs font-semibold text-white transition-colors hover:bg-white/[0.22]"
            >
              <Link2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
              {labels.copyLink}
            </button>
          </div>

          <div ref={headerRef} className="flex items-center gap-3.5 px-5 pb-5 pt-4">
            {logo('h-16 w-16 rounded-xl', 'shadow-sm ring-2 ring-white/20')}
            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-1.5 text-[1.5rem] font-bold leading-[1.15] tracking-tight text-white">
                <span className="min-w-0 break-words">{agent.name}</span>
                {agent.verifiedLabel ? (
                  <BadgeCheck strokeWidth={2.25} className="h-5 w-5 flex-none text-white" aria-label={agent.verifiedLabel} />
                ) : null}
              </h1>
              {agent.subline ? <p className="mt-1 truncate text-[0.8125rem] text-white/75">{agent.subline}</p> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[40rem]">
        <div className="flex flex-col gap-3 px-5 pb-5 pt-4">
          {/* After "Demander une visite" from the sheet, the action returns
              here with ?visit_sent / ?visit_error — the listing page's own
              banners (EnquiryCard). */}
          {visitNotice?.sent ? (
            <div className="rounded-lg bg-success-tint px-3.5 py-2.5 text-[0.8125rem] text-success" role="status">
              <p className="font-semibold">{visitNotice.sent}</p>
              <Link href="/compte/client/visites" className="mt-1 inline-block font-semibold underline underline-offset-2">
                {visitNotice.track}
              </Link>
            </div>
          ) : null}
          {visitNotice?.error ? (
            <p className="rounded-lg bg-danger-tint px-3.5 py-2.5 text-[0.8125rem] font-semibold text-danger" role="alert">
              {visitNotice.error}
            </p>
          ) : null}
          {agent.bio ? <p className="line-clamp-3 text-sm leading-relaxed text-ink-70">{agent.bio}</p> : null}

          <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
            <span className="rounded-full bg-canvas-alt px-3 py-1.5 font-bold text-ink ring-1 ring-inset ring-line/60">
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
            {communesSummary ? (
              <button
                type="button"
                onClick={() => setCommunesOpen((v) => !v)}
                aria-expanded={communesOpen}
                className="inline-flex items-center gap-1 rounded-full bg-canvas-alt px-3 py-1.5 font-semibold text-blue-deep ring-1 ring-inset ring-line/60 hover:bg-surface"
              >
                {communesSummary}
                {communesOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            ) : null}
          </div>
          {communesOpen ? (
            <div className="rounded-[10px] bg-canvas-alt px-3 py-2.5 text-[0.8125rem] leading-relaxed text-ink-70">
              {communes.join(', ')}
            </div>
          ) : null}

          <div className="mt-1 flex rounded-full bg-canvas-alt p-1 ring-1 ring-inset ring-line/60" role="tablist">
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
                  {entry.label} · {entry.items.length}
                </button>
              );
            })}
          </div>
        </div>

        {items.length ? (
          <>
            <div className="flex items-center justify-between border-t border-line/60 px-5 py-3">
              <span className="text-[0.8125rem] text-ink-45">{current.countLabel}</span>
              <button
                type="button"
                onClick={() => setSort((s) => SORTS[(SORTS.indexOf(s) + 1) % SORTS.length])}
                className="u-press inline-flex h-[2.125rem] items-center gap-1.5 rounded-full bg-surface px-3 text-[0.8125rem] font-semibold text-ink ring-1 ring-inset ring-line hover:bg-canvas-alt"
              >
                <ArrowUpDown strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                {labels.sorts[sort]}
              </button>
            </div>
            <ul className="border-t border-line/60 px-5">
              {items.map((item) => (
                <li key={item.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => open(item)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(item); } }}
                    className="flex cursor-pointer flex-col gap-3 border-b border-line/60 py-5"
                  >
                    {/* Full-width photo, details below (owner's direction,
                        2026-11-03: the side thumbnail read as squashed). 4:3,
                        the sheet's own ratio. The save heart sits on it as on
                        PropertyCard (status badge top-left, heart top-right,
                        price with the inline FC pill below); the heart's
                        wrapper is its own click target so a tap on it never
                        opens the sheet. */}
                    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-canvas-alt">
                      {item.photos.length ? (
                        <CardImageCarousel images={item.photos} alt={item.title} sizes="(min-width: 640px) 600px, 100vw" />
                      ) : null}
                      {item.isNew || item.reserved ? (
                        <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
                          <Badges item={item} labels={labels} />
                        </div>
                      ) : null}
                      <div className="absolute right-3 top-3 z-10" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <FavoriteButton listingId={item.id} price={item.price} commune={item.commune} />
                      </div>
                    </div>
                    <div className="@container flex min-w-0 flex-col gap-1">
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
                      {/* A real link, so the listing is crawlable and opens in a
                          new tab on a modified click; a plain tap opens the sheet. */}
                      <Link
                        href={item.href}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) { e.stopPropagation(); return; }
                          e.preventDefault();
                        }}
                        className="mt-0.5 truncate text-base font-medium leading-snug tracking-normal text-ink"
                      >
                        {item.place || item.type}
                      </Link>
                      <TypeAndSpecs item={item} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2.5 border-t border-line/60 px-8 pb-6 pt-12 text-center">
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

      {/* Pinned contact bar: white with the royal WhatsApp button, so the
          page is branded at the top and not boxed in by blue at both ends. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line/60 bg-surface pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-4px_16px_rgba(12,29,80,0.08)]">
        <div className="mx-auto flex max-w-[40rem] items-center gap-3 px-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-ink">{agent.name}</div>
            <div className="truncate text-xs text-ink-45">{agent.barNote}</div>
          </div>
          {agent.telHref ? (
            <a
              href={agent.telHref}
              aria-label={labels.call}
              className="u-press grid h-10 w-10 flex-none place-items-center rounded-lg text-ink ring-[1.5px] ring-inset ring-ink transition-colors hover:bg-ink hover:text-white"
            >
              <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
            </a>
          ) : null}
          {agent.whatsappHref ? (
            <a
              href={agent.whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="u-press flex h-10 flex-none items-center gap-2 rounded-lg bg-blue px-4 text-sm font-bold text-white transition-colors hover:bg-blue-deep"
            >
              <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
              WhatsApp
            </a>
          ) : null}
        </div>
      </div>

      {/* Listing sheet: slides up on a phone, a centred panel on a wide screen. */}
      <div
        onClick={() => setSelectedId(null)}
        aria-hidden="true"
        className={`fixed inset-0 z-[45] bg-[rgba(12,29,80,.42)] transition-opacity duration-300 ease-[cubic-bezier(.2,.7,.3,1)] ${
          selected ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={selected ? `${selected.type} · ${selected.place || ''}` : undefined}
        aria-hidden={!selected}
        className={`fixed inset-x-0 bottom-0 z-[46] mx-auto flex h-[88dvh] max-w-[32rem] flex-col rounded-t-[20px] bg-surface shadow-lg transition-transform duration-300 ease-[cubic-bezier(.2,.7,.3,1)] ${
          selected ? 'translate-y-0' : 'pointer-events-none translate-y-[102%]'
        }`}
      >
        {selected ? (
          <>
            <div className="flex flex-none justify-center pb-2 pt-2.5">
              <span className="h-1 w-9 rounded-full bg-line" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="relative mx-4 aspect-[4/3] overflow-hidden rounded-[14px] bg-canvas-alt">
                {selected.photos.length ? (
                  <CardImageCarousel
                    key={selected.id}
                    images={selected.photos}
                    alt={selected.title}
                    sizes="(min-width: 640px) 32rem, 100vw"
                    onIndexChange={setPhotoIndex}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label={labels.close}
                  className="absolute right-2.5 top-2.5 z-10 grid h-9 w-9 place-items-center rounded-full bg-white/80 text-ink backdrop-blur-md"
                >
                  <X strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
                </button>
                {selected.photos.length > 1 ? (
                  <span className="pointer-events-none absolute bottom-2.5 right-2.5 z-10 rounded-full bg-blue-deep/80 px-2.5 py-1 text-xs font-semibold text-white">
                    {photoIndex + 1} / {selected.photos.length}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-col gap-2 px-5 pb-5 pt-[1.125rem]">
                <Price
                  amount={selected.price}
                  purpose={selected.purpose}
                  pricePeriod={selected.pricePeriod}
                  currency={selected.currency}
                  priceOriginal={selected.priceOriginal}
                  showSubtext
                  className={`${CARD_PRICE_CLASS} sm:text-2xl`}
                  subtextClassName={CARD_FC_PILL_CLASS}
                />
                {selected.isNew || selected.reserved ? (
                  <div className="flex flex-wrap gap-1.5"><Badges item={selected} labels={labels} /></div>
                ) : null}
                {selected.place ? (
                  <p className="mt-1 text-base font-medium leading-snug tracking-normal text-ink">{selected.place}</p>
                ) : null}
                <TypeAndSpecs item={selected} />
                {selected.description ? (
                  <p className="mt-2 whitespace-pre-line border-t border-line/60 pt-3 text-sm leading-relaxed text-ink-70">
                    {selected.description}
                  </p>
                ) : null}
                {selected.reserved ? (
                  <p className="mt-1 rounded-[10px] bg-canvas-alt px-3 py-2.5 text-[0.8125rem] leading-snug text-ink-70">
                    {labels.reservedNote}
                  </p>
                ) : null}
                {/* "Mes visites": several of this agency's listings, one request
                    (lib/visitCart.js) — the listing page's own button. */}
                <div className="mt-3">
                  <AddToVisitCartButton listing={selected.cart} />
                </div>
                <Link href={selected.href} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-blue hover:underline">
                  {labels.viewListing}
                  <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                </Link>
              </div>
            </div>
            <div className="flex flex-none flex-col gap-2.5 border-t border-line/60 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
            <div className={`grid gap-2.5 ${agent.telHref ? 'grid-cols-[3.25rem_minmax(0,1fr)]' : 'grid-cols-1'}`}>
              {agent.telHref ? (
                <a
                  href={agent.telHref}
                  aria-label={labels.call}
                  onClick={() => trackCallClick({ id: selected.id, price: selected.price, commune: selected.commune, agent_phone: agent.telHref })}
                  className="u-press grid h-[3.25rem] place-items-center rounded-lg text-ink ring-[1.5px] ring-inset ring-ink transition-colors hover:bg-ink hover:text-white"
                >
                  <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
                </a>
              ) : null}
              {selected.waHref ? (
                <a
                  href={selected.reserved ? selected.similarHref : selected.waHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackLeadClick({ id: selected.id, price: selected.price, commune: selected.commune }, selected.routingType, 'card')}
                  className="u-press flex h-[3.25rem] items-center justify-center gap-2.5 rounded-lg bg-blue text-[0.9375rem] font-bold text-white transition-colors hover:bg-blue-deep"
                >
                  <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
                  {selected.reserved ? labels.askSimilar : labels.askListing}
                </a>
              ) : (
                <span className="flex h-[3.25rem] items-center justify-center rounded-lg px-4 text-center text-[0.8125rem] text-ink-45 ring-1 ring-inset ring-line">
                  {labels.contactUnavailable}
                </span>
              )}
            </div>
            {/* The tracked path (root CLAUDE.md, "Dual contact policy"): a real
                lead + viewing request, the agent alerted by the engine. The
                listing page's own dialog; it comes back to this profile. Not
                offered on a reserved listing — that visit is not on offer. */}
            {selected.reserved ? null : (
              <button
                type="button"
                onClick={() => setVisitFor(selected.id)}
                className="u-press u-btn-secondary inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-ink"
              >
                <CalendarClock strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
                {labels.requestVisit}
              </button>
            )}
            </div>
          </>
        ) : null}
      </div>

      {visitFor != null ? (
        <VisitRequestDialog
          propertyId={visitFor}
          open
          onOpenChange={(value) => { if (!value) setVisitFor(null); }}
          returnTo={profilePath}
        />
      ) : null}

      <div
        role="status"
        className={`pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex justify-center transition-opacity duration-200 ${toast ? 'opacity-100' : 'opacity-0'}`}
      >
        {toast ? (
          <span className="rounded-full bg-ink px-4 py-2 text-[0.8125rem] font-semibold text-white shadow-md">{labels.linkCopied}</span>
        ) : null}
      </div>
    </div>
  );
}
