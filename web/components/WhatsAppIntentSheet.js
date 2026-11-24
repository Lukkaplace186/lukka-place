'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CalendarClock, ChevronRight, CircleHelp, MapPin, MessageCircle, Phone, Video, X } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import PhoneField from '@/components/PhoneField';
import { resolveWhatsAppRouting } from '@/lib/leadRouting';
import { trackCallClick, trackLeadClick, trackWhatsAppOutcome, trackWhatsAppSheet } from '@/lib/analyticsClient';
import { whatsappIntentEnabled } from '@/lib/whatsappIntent';
import { normalizePhone, telHref } from '@/lib/phone';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useLocale, useT } from '@/lib/i18n/client';
import { isAgentSignedInClient, isLoggedInClient } from '@/lib/customerClient';
import { openAccountFromWhatsAppSheetAction } from '@/app/(site)/listings/whatsappAccountActions';
import { similarAlertQuery } from '@/lib/similarSearch';
import { buildSearchLabel } from '@/lib/searchLabel';
import { getFavoriteIds, getSavedSearches } from '@/lib/localFavorites';
import {
  ACCOUNT_OFFER_STORAGE_KEY, RETURN_PROMPT_MAX_MS, RETURN_PROMPT_MIN_MS, VISIT_CONTACT_STORAGE_KEY,
  accountOfferWillShow, cleanVisitName, isVisitIntent,
} from '@/lib/visitContact';

const OPTIONS = [
  { intent: 'visit', Icon: CalendarClock },
  { intent: 'availability', Icon: CircleHelp },
  { intent: 'question', Icon: MessageCircle },
];

// The second step after « Je veux le visiter », when the agent takes video visits.
const VISIT_OPTIONS = [
  { intent: 'visit', Icon: MapPin, labels: 'listings.waIntent.visitMode.inPerson' },
  { intent: 'video_visit', Icon: Video, labels: 'listings.waIntent.options.video_visit' },
];

// Same name as EnquiryCard's OPEN_VISIT_EVENT (imported there from here would be a cycle).
const OPEN_VISIT_EVENT = 'lukka:open-visit';

function openWhatsApp(href) {
  window.open(href, '_blank', 'noopener,noreferrer');
}

function readStoredContact() {
  try {
    const raw = window.localStorage.getItem(VISIT_CONTACT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
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

function storeContact(contact) {
  try {
    window.localStorage.setItem(VISIT_CONTACT_STORAGE_KEY, JSON.stringify(contact));
  } catch {
    // Private mode or blocked storage: the next visit asks again, nothing else changes.
  }
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
 * WITH A FREE ACCOUNT (2026-11-24, owner). A guest also sees "Créer mon
 * compte gratuit", ticked: with a name and a number it opens the account
 * in the same tap (signed in for a new number, the "homes like this one"
 * alert saved), started without waiting so WhatsApp opens at once. No step
 * is added: the box sits in the visit step's optional fields, and the other
 * answers (« disponible ? », a question) go straight to WhatsApp as before.
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
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState('intent');
  const [videoOffered, setVideoOffered] = useState(false);
  const [pendingIntent, setPendingIntent] = useState(null);
  const [contactError, setContactError] = useState(null);
  const [stored, setStored] = useState(null);
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

  if (!href) return null;

  function show(next) {
    setOpen(next);
    if (!next) {
      setStep('intent');
      setContactError(null);
    }
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
    show(false);
    openWhatsApp(target);
    openedRef.current = { at: Date.now(), intent, href: target };
  }

  // A visit (on site or by video) asks for the optional number first.
  function toVisitContact(intent) {
    setPendingIntent(intent);
    setStored(readStoredContact());
    setContactError(null);
    setStep('contact');
  }

  function choose(intent) {
    if (intent === 'visit' && videoOffered) {
      setStep('visitMode');
      return;
    }
    if (isVisitIntent(intent)) {
      toVisitContact(intent);
      return;
    }
    go(intent);
  }

  function submitContact(event) {
    event.preventDefault();
    event.stopPropagation();
    const form = new FormData(event.currentTarget);
    const typed = String(form.get('visitPhone') || '').trim();
    const country = String(form.get('visitPhoneCountry') || '') || null;
    const name = cleanVisitName(form.get('visitName'));
    if (!typed) {
      go(pendingIntent);
      return;
    }
    const phone = normalizePhone(typed, country);
    if (!phone) {
      setContactError(t('listings.waIntent.contact.invalidPhone'));
      return;
    }
    storeContact({ name, phone: typed, country });
    // "Créer mon compte gratuit" (2026-11-24, ticked by default, guests only):
    // started WITHOUT waiting, in the same tap that opens WhatsApp — it
    // finishes while they write to the agent (app/(site)/listings/whatsappAccountActions.js).
    if (name && form.get('openAccount') === '1' && !isLoggedInClient()) {
      const query = similarAlertQuery(listing);
      let localData = { favoriteIds: [], savedSearches: [] };
      try {
        localData = { favoriteIds: getFavoriteIds(), savedSearches: getSavedSearches() };
      } catch {
        // Storage blocked: the account opens without them.
      }
      openAccountFromWhatsAppSheetAction({
        name,
        phone,
        alert: query ? { query, label: buildSearchLabel(new URLSearchParams(query), t) } : null,
        localData,
      }).catch(() => {});
    }
    go(pendingIntent, { name, phone });
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

  const titleKey = step === 'visitMode'
    ? 'listings.waIntent.visitMode.title'
    : step === 'contact' ? 'listings.waIntent.contact.title' : 'listings.waIntent.title';
  const lead = step === 'visitMode'
    ? t('listings.waIntent.visitMode.lead')
    : step === 'contact' ? t('listings.waIntent.contact.lead', { who }) : t('listings.waIntent.lead', { who });

  return (
    <>
      {standalone ? (
        // Not inside a card link (listing page): a real link to WhatsApp, so a
        // tap before the page's JavaScript has loaded still reaches the agent
        // (2026-11-21 — Kinshasa links are slow and the bundle is heavy; a
        // <button> did nothing until hydration). Once hydrated, onTrigger
        // prevents the navigation and opens the sheet as before.
        <a href={href} target="_blank" rel="noopener noreferrer" onClick={onTrigger} className={className} aria-label={ariaLabel} aria-haspopup="dialog">
          {children}
        </a>
      ) : (
        <button type="button" onClick={onTrigger} className={className} aria-label={ariaLabel} aria-haspopup="dialog">
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
      <Sheet open={open} onOpenChange={show}>
        <SheetContent
          side="bottom"
          className="mx-auto w-full rounded-t-2xl px-4 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-md"
        >
          <SheetHeader className="p-0 text-left">
            <SheetTitle className="text-lg font-semibold text-ink">{t(titleKey)}</SheetTitle>
            <SheetDescription className="text-sm text-ink-70">{lead}</SheetDescription>
          </SheetHeader>
          {step === 'contact' ? (
            <form onSubmit={submitContact} className="flex flex-col gap-3" noValidate>
              <div>
                <label htmlFor="wa-visit-name" className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
                  {t('listings.waIntent.contact.name')}
                </label>
                <input
                  id="wa-visit-name"
                  name="visitName"
                  autoComplete="name"
                  maxLength={80}
                  defaultValue={stored?.name || ''}
                  className="h-11 w-full rounded-lg border border-line bg-surface px-3 text-base text-ink sm:text-sm"
                />
              </div>
              <PhoneField
                name="visitPhone"
                id="wa-visit-phone"
                locale={locale}
                defaultValue={stored?.phone || ''}
                defaultCountry={stored?.country || undefined}
                labels={{ ...phoneFieldLabels(t), label: t('listings.waIntent.contact.phone') }}
                labelClassName="mb-1.5 text-[0.8125rem] font-semibold normal-case tracking-normal text-ink-70"
                fieldClassName="h-11 rounded-lg bg-surface"
              />
              {isLoggedInClient() ? null : (
                <label className="flex items-start gap-2.5 rounded-lg bg-blue-tint px-3 py-2.5 text-[0.8125rem] text-ink">
                  <input type="checkbox" name="openAccount" value="1" defaultChecked className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--blue)]" />
                  <span>
                    <span className="font-semibold">{t('listings.waIntent.contact.openAccount')}</span>
                    <span className="block text-ink-70">{t('listings.waIntent.contact.openAccountHint')}</span>
                  </span>
                </label>
              )}
              {contactError ? <p className="text-sm text-danger" role="alert">{contactError}</p> : null}
              <p className="text-xs text-ink-45">{t('listings.waIntent.contact.privacy', { who })}</p>
              <button
                type="submit"
                className="u-press u-focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-green px-4 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-green-deep"
              >
                {t('listings.waIntent.contact.continue')}
              </button>
              <button
                type="button"
                onClick={() => go(pendingIntent)}
                className="u-focus-ring inline-flex min-h-11 items-center justify-center text-sm font-semibold text-ink-70 underline-offset-2 hover:underline"
              >
                {t('listings.waIntent.contact.skip')}
              </button>
              <button
                type="button"
                onClick={() => setStep(pendingIntent === 'video_visit' || videoOffered ? 'visitMode' : 'intent')}
                className="u-focus-ring inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-ink-70"
              >
                <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                {t('listings.waIntent.visitMode.back')}
              </button>
            </form>
          ) : step === 'visitMode' ? (
            <>
              <ul className="flex flex-col gap-2">
                {VISIT_OPTIONS.map(({ intent, Icon, labels }) => (
                  <li key={intent}>
                    <button
                      type="button"
                      onClick={() => toVisitContact(intent)}
                      className="u-press u-focus-ring flex min-h-14 w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-green"
                    >
                      <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 shrink-0 text-green-deep" aria-hidden="true" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-[0.9375rem] font-semibold text-ink">{t(`${labels}.label`)}</span>
                        <span className="text-[0.8125rem] text-ink-45">{t(`${labels}.hint`)}</span>
                      </span>
                      <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-45" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-xs font-semibold text-warning-ink">{t('listings.waIntent.visitMode.warning')}</p>
              <button
                type="button"
                onClick={() => setStep('intent')}
                className="u-focus-ring inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-ink-70"
              >
                <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                {t('listings.waIntent.visitMode.back')}
              </button>
            </>
          ) : (
          <ul className="flex flex-col gap-2">
            {OPTIONS.map(({ intent, Icon }) => (
              <li key={intent}>
                <button
                  type="button"
                  onClick={() => choose(intent)}
                  className="u-press u-focus-ring flex min-h-14 w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-green"
                >
                  <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 shrink-0 text-green-deep" aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[0.9375rem] font-semibold text-ink">{t(`listings.waIntent.options.${intent}.label`)}</span>
                    <span className="text-[0.8125rem] text-ink-45">{t(`listings.waIntent.options.${intent}.hint`)}</span>
                  </span>
                  <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-45" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          )}
          {step === 'contact' ? null : <p className="text-xs text-ink-45">{t('listings.waIntent.footer')}</p>}
        </SheetContent>
      </Sheet>
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
