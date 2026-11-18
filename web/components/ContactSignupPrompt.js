'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { isAgentSignedInClient, isLoggedInClient } from '@/lib/customerClient';
import { trackCustomerSignup } from '@/lib/analyticsClient';
import {
  WHATSAPP_TAP_EVENT, contactSignupAllowed, readContactSignupState, returnPath, snoozeContactSignup, tappedListingId,
} from '@/lib/contactSignupPrompt';
import { useT } from '@/lib/i18n/client';

// The form is fetched only when the sheet is about to open: this component is
// mounted on every public page, and most visitors never tap WhatsApp.
const QuickSignup = dynamic(() => import('./QuickSignup'), { ssr: false });

const PERKS = ['listings.contactSignup.perkSaved', 'listings.contactSignup.perkAlerts'];

/**
 * After a guest's WhatsApp tap on a listing, when they come back to the page:
 * "Retrouvez ce bien et l'agent plus tard" with the short account form
 * (2026-11-18, lib/contactSignupPrompt.js has the rules). WhatsApp has
 * already opened, so the offer can never cost the contact. The new account
 * keeps the listing as a favourite and this browser's taps
 * (lib/contactTapClaim.js), so /admin/contacts names the customer.
 *
 * Mounted once in app/(site)/layout.js; every listing WhatsApp button
 * reaches it through the event trackLeadClick fires.
 */
export default function ContactSignupPrompt() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [listingId, setListingId] = useState(null);
  const [next, setNext] = useState('/');
  // The tap waiting for the visitor to come back, or null.
  const pending = useRef(null);
  const wentAway = useRef(false);

  useEffect(() => {
    function onTap(event) {
      if (isLoggedInClient() || isAgentSignedInClient()) return;
      if (!contactSignupAllowed(readContactSignupState())) return;
      pending.current = tappedListingId(event.detail);
      wentAway.current = document.visibilityState === 'hidden';
      // Fetch the form while they are in WhatsApp, so the sheet is complete
      // the moment they come back, even on a slow connection.
      import('./QuickSignup').catch(() => {});
    }

    // Away = the tab was hidden (phone: WhatsApp took the screen) or the
    // window lost focus (desktop: WhatsApp's app came to the front).
    function away() {
      if (pending.current != null) wentAway.current = true;
    }

    // Back on the page after WhatsApp.
    function back() {
      if (!wentAway.current || pending.current == null) return;
      const id = pending.current;
      pending.current = null;
      wentAway.current = false;
      if (isLoggedInClient()) return;
      setListingId(id);
      setNext(returnPath(window.location));
      setOpen(true);
      trackCustomerSignup('prompt_shown', 'whatsapp');
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
            <SheetTitle className="text-lg font-semibold text-ink">{t('listings.contactSignup.title')}</SheetTitle>
            <SheetDescription className="text-sm text-ink-70">{t('listings.contactSignup.lead')}</SheetDescription>
          </SheetHeader>
          {open ? (
            <QuickSignup
              next={next}
              entry="whatsapp"
              perkKeys={PERKS}
              alsoSaveIds={listingId ? [listingId] : []}
              idPrefix="contact-signup-"
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
