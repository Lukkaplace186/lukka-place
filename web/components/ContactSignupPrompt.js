'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { isAgentSignedInClient, isLoggedInClient } from '@/lib/customerClient';
import { trackCustomerSignup } from '@/lib/analyticsClient';
import {
  WHATSAPP_TAP_EVENT, contactSignupAllowed, keepListingNext, readContactSignupState, similarAlertNext, snoozeContactSignup, tappedListingId,
} from '@/lib/contactSignupPrompt';

// The sheet (Radix) and its form are fetched only when they can be needed:
// this component is mounted on every public page, and most visitors never tap
// WhatsApp (2026-11-22: the sheet used to be in every first load).
const loadForm = () => import('@/app/(site)/compte/connexion/WhatsAppSignInForm');
const loadSheet = () => import('./ContactSignupSheet');
const ContactSignupSheet = dynamic(loadSheet, { ssr: false });
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
  const [open, setOpen] = useState(false);
  // Mounted on the first return, then kept so its closing animation plays.
  const [mounted, setMounted] = useState(false);
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
      loadSheet().catch(() => {});
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
      setMounted(true);
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

  if (!mounted) return null;
  return <ContactSignupSheet open={open} onOpenChange={onOpenChange} next={next} entry={ENTRY} offer={offer} />;
}
