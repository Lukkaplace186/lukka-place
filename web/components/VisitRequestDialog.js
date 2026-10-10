'use client';

import { useEffect, useId, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { useIsLoggedIn } from '@/lib/customerClient';
import { submitVisitRequestAction } from '@/app/(site)/listings/[id]/actions';
import VisitSlotPicker from './VisitSlotPicker';
import PhoneField from './PhoneField';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { useLocale, useT } from '@/lib/i18n/client';

const FIELD_CLASS =
  'u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-35';

// One request per page load: several of these dialogs can be mounted at once
// (the listing page's two EnquiryCards), and they all want the same profile.
let accountProfilePromise = null;
function loadAccountProfile() {
  if (!accountProfilePromise) {
    accountProfilePromise = fetch('/api/account/me', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return accountProfilePromise;
}

/**
 * "Demander une visite" — the booking dialog: name, WhatsApp number, then the
 * visit calendar (VisitSlotPicker: a real day and hour, not free text). It
 * posts to submitVisitRequestAction, which creates the lead and the viewing
 * request and alerts the listing's own agent from the engine; nothing here
 * opens a chat.
 *
 * Controlled (`open` / `onOpenChange`), so every surface that offers a visit
 * opens the SAME dialog: the listing page (EnquiryCard, MobileListingBar) and
 * the saved-listings board. The board's button used to be a hand-built wa.me
 * link to Lukka Place's own number asking "quelles sont vos disponibilités ?"
 * — a second, untracked way to ask for a visit that reached neither the agent
 * nor the customer's agenda (reported 2026-10-10).
 *
 * `returnTo="visites"` sends the customer to their agenda afterwards, where
 * the request and the agent's answer are; the default returns to the listing.
 * The redirect closes the dialog (a navigation unmounts it).
 */
export default function VisitRequestDialog({ propertyId, open, onOpenChange, returnTo = null, subject = null }) {
  const t = useT();
  const locale = useLocale();
  const uid = useId();
  const [slot, setSlot] = useState(null);
  const bound = submitVisitRequestAction.bind(null, propertyId);

  // A signed-in customer's visit request is found in their account by
  // phone number, so the form opens with the account's own number (and
  // name) already in it — see app/api/account/me/route.js. Still editable:
  // someone booking for a relative may genuinely want another number.
  const loggedIn = useIsLoggedIn();
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    if (!loggedIn) return undefined;
    let live = true;
    loadAccountProfile().then((value) => {
      if (live && value) setProfile(value);
    });
    return () => {
      live = false;
    };
  }, [loggedIn]);
  // Uncontrolled fields read defaultValue once, so they remount when the
  // profile arrives. It is fetched on page load, well before a visitor
  // reaches the button, so nothing typed is lost to the remount.
  const prefillKey = profile ? 'account' : 'anonymous';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Centred, and the site header (h-16, z-[60]) paints over a dialog: 9.5rem
          keeps the title clear of it on a phone, where the calendar makes
          this dialog taller than the screen. */}
      <DialogContent className="max-h-[calc(100dvh-9.5rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('enquiry.requestViewing')}</DialogTitle>
          <DialogDescription>{subject ? `${subject} — ${t('enquiry.intro')}` : t('enquiry.intro')}</DialogDescription>
        </DialogHeader>

        <form action={bound} className="flex flex-col gap-4">
          {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}

          {/* The calendar first: it is what the visitor came to do. */}
          <VisitSlotPicker propertyId={propertyId} name="preferred_slot_at" value={slot} onChange={setSlot} idPrefix={`${uid}slot`} />

          <div>
            <label htmlFor={`${uid}name`} className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
              {t('enquiry.nameOptional')}
            </label>
            <input
              key={prefillKey}
              id={`${uid}name`}
              name="name"
              autoComplete="name"
              enterKeyHint="next"
              defaultValue={profile?.fullName || ''}
              placeholder={t('enquiry.namePlaceholder')}
              className={FIELD_CLASS}
            />
          </div>

          <PhoneField
            key={prefillKey}
            name="phone"
            id={`${uid}phone`}
            locale={locale}
            {...(profile?.phoneCountry
              ? { defaultCountry: profile.phoneCountry, defaultValue: profile.phoneNational, detectCountry: false }
              : {})}
            labels={{ ...phoneFieldLabels(t), label: t('enquiry.whatsappNumber') }}
            labelClassName="mb-1.5 text-[0.8125rem] font-semibold normal-case tracking-normal text-ink-70"
            fieldClassName="h-11 rounded-lg bg-surface"
            required
          />

          <DialogFooter>
            <DialogClose asChild>
              <button type="button" className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink-70 hover:bg-canvas-alt">
                {t('common.actions.cancel')}
              </button>
            </DialogClose>
            <button
              type="submit"
              disabled={!slot}
              className="u-btn-primary u-press rounded-lg bg-blue px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {t('enquiry.submit')}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
