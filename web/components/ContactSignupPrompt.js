'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Check } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { isAgentSignedInClient, isLoggedInClient } from '@/lib/customerClient';
import { trackCustomerSignup } from '@/lib/analyticsClient';
import {
  WHATSAPP_TAP_EVENT, contactSignupAllowed, keepListingNext, readContactSignupState, similarAlertNext, snoozeContactSignup, tappedListingId,
} from '@/lib/contactSignupPrompt';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

// The form is fetched only when it can be needed: this component is mounted
// on every public page, and most visitors never tap WhatsApp.
const loadForm = () => import('@/app/(site)/compte/connexion/WhatsAppSignInForm');
const WhatsAppSignInForm = dynamic(loadForm, { ssr: false });

const PERKS = ['listings.contactSignup.perkSaved', 'listings.contactSignup.perkAlerts'];
// With a "homes like this one" search (2026-11-24): the alert first, it is the promise.
const SIMILAR_PERKS = ['listings.contactSignup.perkSimilar', 'listings.contactSignup.perkSaved'];
const ENTRY = 'after_whatsapp';

/**
 * After a guest's WhatsApp tap on a listing, when they come back to the page:
 * "Retrouvez ce bien et l'agent plus tard" with "Continuer avec WhatsApp"
 * (2026-11-18; rules in lib/contactSignupPrompt.js). WhatsApp has already
 * opened, so the offer can never cost the contact. Signing in saves the
 * contacted listing (the favourite-resume marker in `next`) and claims this
 * browser's taps (lib/contactTapClaim.js), so /admin/contacts names the
 * customer.
 *
 * Mounted once in app/(site)/layout.js; every listing WhatsApp button
 * reaches it through the event trackLeadClick fires.
 *
 * Made specific on 2026-11-24 (1 opened out of 36 shown in 14 days): when the
 * listing has a "homes like this one" search, the sheet offers exactly that
 * ("Recevez les biens comme celui-ci") and signing in lands on those results
 * with the alert saved (lib/contactSignupPrompt.js similarAlertNext); the
 * name and number typed in the visit sheet, if any, are already in the form,
 * so a known face is one tap from the code screen.
 */
export default function ContactSignupPrompt() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState('/');
  const [offer, setOffer] = useState({ similar: false, name: '', phone: null });
  // The tap waiting for the visitor to come back, or null.
  const pending = useRef(null);
  const wentAway = useRef(false);

  useEffect(() => {
    function onTap(event) {
      if (isLoggedInClient() || isAgentSignedInClient()) return;
      if (!contactSignupAllowed(readContactSignupState())) return;
      pending.current = {
        id: tappedListingId(event.detail) ?? 0,
        similarQuery: event.detail?.similarQuery || null,
        name: event.detail?.name || '',
        phone: event.detail?.phone || null,
      };
      wentAway.current = document.visibilityState === 'hidden';
      // Fetch the form while they are in WhatsApp, so the sheet is complete
      // the moment they come back, even on a slow connection.
      loadForm().catch(() => {});
    }

    // Away = the tab was hidden (phone: WhatsApp took the screen) or the
    // window lost focus (desktop: WhatsApp's app came to the front).
    function away() {
      if (pending.current != null) wentAway.current = true;
    }

    // Back on the page after WhatsApp.
    function back() {
      if (!wentAway.current || pending.current == null) return;
      const tap = pending.current;
      pending.current = null;
      wentAway.current = false;
      if (isLoggedInClient()) return;
      const similarNext = similarAlertNext(tap.similarQuery, tap.id);
      setNext(similarNext || keepListingNext(window.location, tap.id));
      setOffer({ similar: Boolean(similarNext), name: tap.name || '', phone: tap.phone || null });
      setOpen(true);
      trackCustomerSignup('prompt_shown', ENTRY);
    }

    function onVisibility() {
      if (document.visibilityState === 'hidden') away();
      else back();
    }

    window.addEventListener(WHATSAPP_TAP_EVENT, onTap);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', away);
    window.addEventListener('focus', back);
    return () => {
      window.removeEventListener(WHATSAPP_TAP_EVENT, onTap);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', away);
      window.removeEventListener('focus', back);
    };
  }, []);

  // Closing it any way (✕, backdrop, Échap, « Non merci ») counts as no.
  function onOpenChange(nextOpen) {
    setOpen(nextOpen);
    if (!nextOpen) snoozeContactSignup();
  }

  return (
    // The sheet portals to <body>; this wrapper keeps its clicks from
    // bubbling into whatever React tree mounted it.
    <span className="contents" onClick={(event) => event.stopPropagation()}>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="mx-auto max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl px-4 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-md"
        >
          <SheetHeader className="p-0 text-left">
            <SheetTitle className="text-lg font-semibold text-ink">
              {t(offer.similar ? 'listings.contactSignup.titleSimilar' : 'listings.contactSignup.title')}
            </SheetTitle>
            <SheetDescription className="text-sm text-ink-70">
              {t(offer.phone ? 'listings.contactSignup.leadKnown' : 'listings.contactSignup.lead')}
            </SheetDescription>
          </SheetHeader>
          <ul className="flex flex-col gap-1.5">
            {(offer.similar ? SIMILAR_PERKS : PERKS).map((key) => (
              <li key={key} className="flex items-start gap-2 text-sm text-ink-70">
                <Check strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-green-deep" aria-hidden="true" />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
          {open ? (
            <WhatsAppSignInForm
              next={next}
              entry={ENTRY}
              defaultE164={offer.phone}
              defaultName={offer.name}
              onSubmit={() => trackCustomerSignup('prompt_open', ENTRY)}
            />
          ) : null}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="u-focus-ring inline-flex min-h-11 items-center justify-center self-center text-sm font-semibold text-ink-70 hover:text-ink"
          >
            {t('listings.contactSignup.noThanks')}
          </button>
        </SheetContent>
      </Sheet>
    </span>
  );
}
