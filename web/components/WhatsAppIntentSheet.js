'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { CalendarClock, Phone, X } from 'lucide-react';
import { resolveWhatsAppRouting } from '@/lib/leadRouting';
import { trackCallClick, trackLeadClick, trackWhatsAppOutcome, trackWhatsAppSheet } from '@/lib/analyticsClient';
import { whatsappIntentEnabled } from '@/lib/whatsappIntent';
import { telHref } from '@/lib/phone';
import { ICON_STROKE_WIDTH } from '@/lib/iconStyle';
import { useT } from '@/lib/i18n/client';
import { isAgentSignedInClient, isLoggedInClient } from '@/lib/customerClient';
import { openAccountFromWhatsAppSheetAction } from '@/app/(site)/listings/whatsappAccountActions';
import { similarAlertQuery } from '@/lib/similarSearch';
import { buildSearchLabel } from '@/lib/searchLabel';
import { getFavoriteIds, getSavedSearches } from '@/lib/localFavorites';
import { ACCOUNT_OFFER_STORAGE_KEY, RETURN_PROMPT_MAX_MS, RETURN_PROMPT_MIN_MS, accountOfferWillShow } from '@/lib/visitContact';
import { prefersLightData } from '@/lib/useSaveData';

/*
 * The sheet itself (Radix Sheet, PhoneField and its country list) is its own
 * chunk since 2026-11-21 (components/WhatsAppIntentPanel.js): ~15 KB gzip that
 * every page with a listing card paid before anyone tapped. It is fetched on
 * hover / focus / touch of the button, and on the listing page (`standalone`,
 * the page's main action) once the browser is idle unless Data Saver is on, so
 * the first tap still opens the sheet at once.
 */
const loadPanel = () => import('./WhatsAppIntentPanel');
const WhatsAppIntentPanel = dynamic(loadPanel, { ssr: false });
const warmPanel = () => { loadPanel().catch(() => {}); };

// Same name as EnquiryCard's OPEN_VISIT_EVENT (imported there from here would be a cycle).
const OPEN_VISIT_EVENT = 'lukka:open-visit';

function openWhatsApp(href) {
  window.open(href, '_blank', 'noopener,noreferrer');
}

/** Whether the app branch's account offer opens on this return (lib/visitContact.js). */
function accountOfferOpens() {
  let stored = null;
  try {
    stored = JSON.parse(window.localStorage.getItem(ACCOUNT_OFFER_STORAGE_KEY) || 'null');
  } catch {
    stored = null;
  }
  return accountOfferWillShow({ signedIn: isLoggedInClient() || isAgentSignedInClient(), stored });
}

/**
 * A listing's WhatsApp button that first asks what the customer wants —
 * visit, "toujours disponible ?", or another question — and opens WhatsApp
 * with that question already typed (lib/whatsappIntent.js, 2026-11-16).
 * The choice is sent with the tap (`whatsapp_clicks.intent`), so the agent's
 * alert and /admin/contacts know an appointment request from an enquiry.
 *
 * Renders the trigger itself (a `<button>`, never an `<a>`: card buttons
 * sit inside the card's own `<Link>`, see WhatsAppCTA.js). Every click stops
 * there — the trigger's and the sheet's — so a card never navigates behind
 * the sheet. `NEXT_PUBLIC_WHATSAPP_INTENT=off` makes it one tap again, with
 * the old combined question.
 *
 * « Je veux le visiter » asks one more thing when the listing's agent takes
 * video visits (2026-11-16, lib/visitMode.js — their switch, read from the
 * slots API when the sheet opens): sur place or par appel vidéo. The video
 * answer pre-types « … par appel vidéo WhatsApp » and is logged as
 * `video_visit`. Not known yet (the read still running or failed) → no
 * second step, the visit is asked as before.
 *
 * THE CUSTOMER'S NUMBER, OPTIONAL (2026-11-20, owner). Before WhatsApp opens
 * on a visit, the customer may leave a name and a WhatsApp number "to receive
 * the visit confirmation" — or skip. It goes with the tap to the engine (never
 * into the analytics tables): the agent's alert names them, a lead is made in
 * the agent's Demandes, and when the agent answers « Visite fixée » the visit
 * is created under that number (engine services/directVisit.js), so the
 * confirmation, reminders and bon de visite reach the customer. Remembered on
 * this device (localStorage) to prefill the next time.
 *
 * « VOTRE MESSAGE EST PARTI ? » (2026-11-20). A tap is not a message. When the
 * customer comes back to this page 3 s – 30 min after WhatsApp opened, a small
 * card asks; the answer is a listing event (whatsapp_sent / whatsapp_not_sent),
 * and "Je n'ai pas réussi" offers to try again, call, or ask for a visit here.
 * Not when the account offer opens on that return (a guest who has not said
 * « Non merci »): one sheet at a time (lib/visitContact.js accountOfferWillShow).
 *
 * @param {{listing: Object, placement?: string, className: string, children: React.ReactNode, ariaLabel?: string}} props
 */
export default function WhatsAppIntentButton({ listing, placement, className, children, ariaLabel, standalone = false }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // The panel mounts on the first opening and stays (exit animation, next opening).
  const [panelMounted, setPanelMounted] = useState(false);
  const [videoOffered, setVideoOffered] = useState(false);
  const [prompt, setPrompt] = useState(null);
  const openedRef = useRef(null);
  const { href, routingType } = resolveWhatsAppRouting(listing);

  // Back from WhatsApp: ask once whether the message left.
  useEffect(() => {
    function onVisible() {
      const opened = openedRef.current;
      if (document.visibilityState !== 'visible' || !opened) return;
      const elapsed = Date.now() - opened.at;
      if (elapsed < RETURN_PROMPT_MIN_MS) return;
      openedRef.current = null;
      if (elapsed > RETURN_PROMPT_MAX_MS) return;
      // A guest gets the account offer on this return instead; never two sheets.
      if (accountOfferOpens()) return;
      setPrompt({ stage: 'ask', intent: opened.intent, href: opened.href });
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // The listing page's own button: warm the sheet while the browser is idle.
  useEffect(() => {
    if (!standalone || !href || prefersLightData()) return undefined;
    const idle = window.requestIdleCallback || ((fn) => window.setTimeout(fn, 2000));
    const cancel = window.cancelIdleCallback || window.clearTimeout;
    const handle = idle(warmPanel, { timeout: 5000 });
    return () => cancel(handle);
  }, [standalone, href]);

  if (!href) return null;

  function show(next) {
    if (next) setPanelMounted(true);
    setOpen(next);
  }

  // Whether the agent takes video visits — read while the customer reads the
  // sheet, so the second step is ready by the time they tap « visiter ».
  function readVideoOffer() {
    if (!listing?.id) return;
    fetch(`/api/listings/${listing.id}/visit-slots`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setVideoOffered(data?.videoVisits === true))
      .catch(() => {});
  }

  function onTrigger(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!whatsappIntentEnabled()) {
      trackLeadClick(listing, routingType, placement);
      openWhatsApp(href);
      return;
    }
    readVideoOffer();
    show(true);
    trackWhatsAppSheet('open', listing, placement);
  }

  function go(intent, contact = null) {
    const chosen = resolveWhatsAppRouting(listing, intent);
    const target = chosen.href || href;
    trackWhatsAppSheet('choose', listing, placement);
    trackLeadClick(listing, chosen.routingType, placement, intent, contact);
    // "Créer mon compte gratuit" in the visit step (2026-11-24, ticked by
    // default, guests only): started WITHOUT waiting in the same tap that
    // opens WhatsApp; it finishes while they write to the agent
    // (app/(site)/listings/whatsappAccountActions.js).
    if (contact?.openAccount && contact.name && contact.phone && !isLoggedInClient()) {
      const query = similarAlertQuery(listing);
      let localData = { favoriteIds: [], savedSearches: [] };
      try {
        localData = { favoriteIds: getFavoriteIds(), savedSearches: getSavedSearches() };
      } catch {
        // Storage blocked: the account opens without them.
      }
      openAccountFromWhatsAppSheetAction({
        name: contact.name,
        phone: contact.phone,
        alert: query ? { query, label: buildSearchLabel(new URLSearchParams(query), t) } : null,
        localData,
      }).catch(() => {});
    }
    show(false);
    openWhatsApp(target);
    openedRef.current = { at: Date.now(), intent, href: target };
  }

  function answerPrompt(sent) {
    trackWhatsAppOutcome(listing, sent, prompt?.intent || null);
    if (sent) {
      setPrompt(null);
      return;
    }
    setPrompt((current) => (current ? { ...current, stage: 'failed' } : null));
  }

  function retry() {
    const again = prompt?.href || href;
    setPrompt(null);
    openWhatsApp(again);
    openedRef.current = { at: Date.now(), intent: prompt?.intent || null, href: again };
  }

  function askVisitHere() {
    setPrompt(null);
    const onListingPage = typeof window !== 'undefined' && window.location.pathname === `/listings/${listing.id}`;
    if (onListingPage) window.dispatchEvent(new CustomEvent(OPEN_VISIT_EVENT, { detail: { propertyId: listing.id } }));
    else window.location.assign(`/listings/${listing.id}`);
  }

  // The agency's name when the listing has a routable agent (lib/listings.js
  // AGENCY_NAME_EXPR); "l'agent" otherwise — we never name someone we don't route to.
  const who = listing?.agent_phone && listing?.agency_name ? listing.agency_name : t('listings.waIntent.theAgent');

  return (
    <>
      {standalone ? (
        // Not inside a card link (listing page): a real link to WhatsApp, so a
        // tap before the page's JavaScript has loaded still reaches the agent
        // (2026-11-21 — Kinshasa links are slow and the bundle is heavy; a
        // <button> did nothing until hydration). Once hydrated, onTrigger
        // prevents the navigation and opens the sheet as before.
        <a href={href} target="_blank" rel="noopener noreferrer" onClick={onTrigger} onPointerEnter={warmPanel} onPointerDown={warmPanel} onFocus={warmPanel} className={className} aria-label={ariaLabel} aria-haspopup="dialog">
          {children}
        </a>
      ) : (
        <button type="button" onClick={onTrigger} onPointerEnter={warmPanel} onPointerDown={warmPanel} onFocus={warmPanel} className={className} aria-label={ariaLabel} aria-haspopup="dialog">
          {children}
        </button>
      )}
      {/* The sheet is portalled to <body>, but React still bubbles its events
          through this tree — up to the card's <Link>. This wrapper stops every
          click from the sheet, the dimmed backdrop included (it stays mounted
          for its exit animation, so a tap outside lands on it), so neither a
          choice nor a dismissal ever opens the listing behind. Same for the
          « message parti ? » card below. */}
      <span className="contents" onClick={(event) => event.stopPropagation()}>
      {panelMounted ? (
        <WhatsAppIntentPanel open={open} onOpenChange={show} who={who} videoOffered={videoOffered} onGo={go} />
      ) : null}
      {prompt && typeof document !== 'undefined'
        ? createPortal(
          <div
            role="dialog"
            aria-live="polite"
            aria-label={t('listings.waIntent.returnPrompt.title')}
            onClick={(event) => event.stopPropagation()}
            className="u-rise fixed inset-x-3 bottom-24 z-50 mx-auto max-w-md rounded-2xl border border-line bg-surface p-4 shadow-lg lg:bottom-6"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-[0.9375rem] font-semibold text-ink">
                {prompt.stage === 'ask' ? t('listings.waIntent.returnPrompt.title') : t('listings.waIntent.returnPrompt.failedTitle')}
              </p>
              <button
                type="button"
                onClick={() => setPrompt(null)}
                aria-label={t('listings.waIntent.returnPrompt.close')}
                className="u-hit relative -m-1 rounded-full p-1 text-ink-45 hover:text-ink"
              >
                <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {prompt.stage === 'ask' ? (
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => answerPrompt(true)} className="u-press min-h-11 flex-1 rounded-xl bg-green px-3 text-sm font-semibold text-white hover:bg-green-deep">
                  {t('listings.waIntent.returnPrompt.yes')}
                </button>
                <button type="button" onClick={() => answerPrompt(false)} className="u-press min-h-11 flex-1 rounded-xl border border-line px-3 text-sm font-semibold text-ink hover:border-blue">
                  {t('listings.waIntent.returnPrompt.no')}
                </button>
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                <button type="button" onClick={retry} className="u-press min-h-11 rounded-xl bg-green px-3 text-sm font-semibold text-white hover:bg-green-deep">
                  {t('listings.waIntent.returnPrompt.retry')}
                </button>
                {listing?.agent_phone ? (
                  <a
                    href={telHref(listing.agent_phone)}
                    onClick={() => { trackCallClick(listing); setPrompt(null); }}
                    className="u-press inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold text-ink hover:border-blue"
                  >
                    <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                    {t('listings.waIntent.returnPrompt.call')}
                  </a>
                ) : null}
                <button type="button" onClick={askVisitHere} className="u-press inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold text-ink hover:border-blue">
                  <CalendarClock strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                  {t('listings.waIntent.returnPrompt.visit')}
                </button>
              </div>
            )}
          </div>,
          document.body,
        )
        : null}
      </span>
    </>
  );
}
