'use client';

import { useEffect, useId, useState } from 'react';
import { MapPin, Video } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { useIsLoggedIn } from '@/lib/customerClient';
import { submitVisitRequestAction } from '@/app/(site)/listings/[id]/actions';
import VisitSlotPicker from './VisitSlotPicker';
import PhoneField from './PhoneField';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { useLocale, useT } from '@/lib/i18n/client';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';

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
 *
 * "Sur place" / "Par appel vidéo" (2026-11-16, lib/visitMode.js) sits above
 * the calendar once the slots API says the agent takes video visits (their
 * switch, on by default); otherwise nothing is offered and the visit is in
 * person, as before. A video visit shows the visitor's own clock beside the
 * listing's, and the owner's payment warning.
 */
export default function VisitRequestDialog({ propertyId, open, onOpenChange, returnTo = null, subject = null }) {
  const t = useT();
  const locale = useLocale();
  const uid = useId();
  const [slot, setSlot] = useState(null);
  const [mode, setMode] = useState('in_person');
  // Known once the calendar's slots API answered (VisitSlotPicker onInfo).
  const [videoOffered, setVideoOffered] = useState(false);
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

          <input type="hidden" name="visit_mode" value={videoOffered ? mode : 'in_person'} />
          {videoOffered ? (
            <fieldset>
              <legend className="mb-1.5 text-[0.8125rem] font-semibold text-ink-70">{t('enquiry.visitMode.label')}</legend>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['in_person', MapPin],
                  ['video', Video],
                ].map(([value, Icon]) => (
                  <label
                    key={value}
                    className={cn(
                      'u-press flex min-h-14 cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue',
                      mode === value ? 'border-blue bg-blue-tint' : 'border-line bg-surface',
                    )}
                  >
                    <input
                      type="radio"
                      name={`${uid}mode`}
                      value={value}
                      checked={mode === value}
                      onChange={() => setMode(value)}
                      className="sr-only"
                    />
                    <Icon
                      strokeWidth={ICON_STROKE_WIDTH}
                      className={cn('mt-0.5 h-5 w-5 flex-none', mode === value ? 'text-blue' : 'text-ink-45')}
                      aria-hidden="true"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm font-semibold text-ink">{t(`enquiry.visitMode.${value === 'video' ? 'video' : 'inPerson'}`)}</span>
                      <span className="text-xs text-ink-45">{t(`enquiry.visitMode.${value === 'video' ? 'videoHint' : 'inPersonHint'}`)}</span>
                    </span>
                  </label>
                ))}
              </div>
              {mode === 'video' ? (
                <div className="mt-2 rounded-lg bg-warning-tint px-3 py-2 text-[0.8125rem] text-warning-ink">
                  <p>{t('enquiry.visitMode.videoNote')}</p>
                  <p className="mt-1 font-semibold">{t('enquiry.visitMode.warning')}</p>
                </div>
              ) : null}
            </fieldset>
          ) : null}

          {/* The calendar first: it is what the visitor came to do. */}
          <VisitSlotPicker
            propertyId={propertyId}
            name="preferred_slot_at"
            value={slot}
            onChange={setSlot}
            idPrefix={`${uid}slot`}
            visitMode={videoOffered ? mode : 'in_person'}
            onInfo={(info) => setVideoOffered(Boolean(info?.videoVisits))}
          />

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
