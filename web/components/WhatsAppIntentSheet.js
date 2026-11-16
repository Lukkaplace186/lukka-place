'use client';

import { useState } from 'react';
import { ArrowLeft, CalendarClock, ChevronRight, CircleHelp, MapPin, MessageCircle, Video } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { resolveWhatsAppRouting } from '@/lib/leadRouting';
import { trackLeadClick } from '@/lib/analyticsClient';
import { whatsappIntentEnabled } from '@/lib/whatsappIntent';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

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

function openWhatsApp(href) {
  window.open(href, '_blank', 'noopener,noreferrer');
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
 * @param {{listing: Object, placement?: string, className: string, children: React.ReactNode, ariaLabel?: string}} props
 */
export default function WhatsAppIntentButton({ listing, placement, className, children, ariaLabel }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState('intent');
  const [videoOffered, setVideoOffered] = useState(false);
  const { href, routingType } = resolveWhatsAppRouting(listing);
  if (!href) return null;

  function show(next) {
    setOpen(next);
    if (!next) setStep('intent');
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
  }

  function go(intent) {
    const chosen = resolveWhatsAppRouting(listing, intent);
    trackLeadClick(listing, chosen.routingType, placement, intent);
    show(false);
    openWhatsApp(chosen.href || href);
  }

  function choose(intent) {
    if (intent === 'visit' && videoOffered) {
      setStep('visitMode');
      return;
    }
    go(intent);
  }

  // The agency's name when the listing has a routable agent (lib/listings.js
  // AGENCY_NAME_EXPR); "l'agent" otherwise — we never name someone we don't route to.
  const who = listing?.agent_phone && listing?.agency_name ? listing.agency_name : t('listings.waIntent.theAgent');

  return (
    <>
      <button type="button" onClick={onTrigger} className={className} aria-label={ariaLabel} aria-haspopup="dialog">
        {children}
      </button>
      {/* The sheet is portalled to <body>, but React still bubbles its events
          through this tree — up to the card's <Link>. This wrapper stops every
          click from the sheet, the dimmed backdrop included (it stays mounted
          for its exit animation, so a tap outside lands on it), so neither a
          choice nor a dismissal ever opens the listing behind. */}
      <span className="contents" onClick={(event) => event.stopPropagation()}>
      <Sheet open={open} onOpenChange={show}>
        <SheetContent
          side="bottom"
          className="mx-auto w-full rounded-t-2xl px-4 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-md"
        >
          <SheetHeader className="p-0 text-left">
            <SheetTitle className="text-lg font-semibold text-ink">
              {t(step === 'visitMode' ? 'listings.waIntent.visitMode.title' : 'listings.waIntent.title')}
            </SheetTitle>
            <SheetDescription className="text-sm text-ink-70">
              {step === 'visitMode' ? t('listings.waIntent.visitMode.lead') : t('listings.waIntent.lead', { who })}
            </SheetDescription>
          </SheetHeader>
          {step === 'visitMode' ? (
            <>
              <ul className="flex flex-col gap-2">
                {VISIT_OPTIONS.map(({ intent, Icon, labels }) => (
                  <li key={intent}>
                    <button
                      type="button"
                      onClick={() => go(intent)}
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
          <p className="text-xs text-ink-45">{t('listings.waIntent.footer')}</p>
        </SheetContent>
      </Sheet>
      </span>
    </>
  );
}
