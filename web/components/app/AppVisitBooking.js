'use client';

import { useEffect, useId, useState } from 'react';
import Link from '@/components/LocaleLink';
import { AnimatePresence, m } from 'motion/react';
import { CalendarClock, Check, ChevronLeft } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import Price from '@/components/Price';
import VisitSlotPicker from '@/components/VisitSlotPicker';
import PhoneField from '@/components/PhoneField';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { useIsLoggedIn } from '@/lib/customerClient';
import { formatVisitSlot } from '@/lib/visitAgenda';
import { feedLocationLine, listingImages } from '@/lib/listingView';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useLocale, useT } from '@/lib/i18n/client';
import { submitVisitRequestAction } from '@/app/(site)/listings/[id]/actions';

const VISIT_ERROR_KEYS = { phone: 'enquiry.errors.phone', time: 'enquiry.errors.time', closed: 'enquiry.errors.closed', 1: 'enquiry.errors.failed' };
const FIELD = 'u-focus-ring h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[0.9375rem] text-ink placeholder:text-ink-35';

// Each step slides in from the side it comes from: forward from the right,
// back from the left. Only on a tap, never on its own.
const slide = {
  enter: (dir) => ({ x: dir > 0 ? 28 : -28, opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { type: 'spring', stiffness: 380, damping: 36 } },
};

function ListingSummary({ listing }) {
  const where = feedLocationLine(listing);
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
      <span className="relative h-14 w-14 flex-none overflow-hidden rounded-xl bg-canvas-alt">
        <SafeImage src={listingImages(listing)[0]} alt="" fill sizes="56px" className="object-cover" />
      </span>
      <span className="min-w-0">
        {where ? <span className="block truncate text-[0.9375rem] font-bold text-ink">{where}</span> : null}
        <span className="u-tabular block text-[0.8125rem] text-ink-45">
          <Price amount={listing.price} purpose={listing.purpose} pricePeriod={listing.price_period} periodClassName="ml-1" />
          {listing.agency_name ? ` · ${listing.agency_name}` : ''}
        </span>
      </span>
    </div>
  );
}

/**
 * The app's visit booking (the app design's "Book a viewing", steps 1–2 and
 * "Viewing requested"), on the website's own pieces: the same calendar
 * (VisitSlotPicker — real days and hours, the agent's days off and confirmed
 * visits greyed out), the same fields, and the same server action, which
 * creates the lead and the visit request and alerts the agent from the
 * engine. One form spans both steps, so the picked slot is posted with the
 * details; the action answers back here (`return_to=app`) with `sent`
 * ('1' agent, 'team' Lukka Place's desk) or an `error` key.
 *
 * Not in the design and deliberately: a video-call choice (not offered by
 * Lukka Place) and "add to calendar" (the time is a request until the agent
 * confirms it).
 */
export default function AppVisitBooking({ listing, sent = null, error = null }) {
  const t = useT();
  const locale = useLocale();
  const uid = useId();
  const [slot, setSlot] = useState(null);
  // An error comes back as a fresh page, so the slot has to be picked again:
  // always open on step 1, with the error shown above it.
  const [step, setStep] = useState(1);
  const [dir, setDir] = useState(1);
  const bound = submitVisitRequestAction.bind(null, listing.id);

  // The account's own name and number, as the website's dialog does (still editable).
  const loggedIn = useIsLoggedIn();
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    if (!loggedIn) return undefined;
    let live = true;
    fetch('/api/account/me', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((value) => live && value && setProfile(value))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [loggedIn]);
  const prefillKey = profile ? 'account' : 'anonymous';

  function go(next) {
    setDir(next > step ? 1 : -1);
    setStep(next);
    window.scrollTo({ top: 0 });
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-lg px-5 pb-10 pt-8">
        <m.span
          initial={{ scale: 0.6 }}
          animate={{ scale: 1, transition: { type: 'spring', stiffness: 420, damping: 18 } }}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-green-tint text-green-ink"
        >
          <Check strokeWidth={2.5} className="h-8 w-8" aria-hidden="true" />
        </m.span>
        <h1 className="u-app-serif mt-6 text-[2.25rem] leading-[1.05] text-ink">{t('appShell.visit.doneTitle')}</h1>
        <p className="mt-3 text-[0.9375rem] text-ink-70">{t(sent === 'team' ? 'enquiry.sentTeam' : 'enquiry.sent')}</p>
        <div className="mt-6">
          <ListingSummary listing={listing} />
        </div>
        <div className="mt-8 space-y-3">
          <Link
            href={loggedIn ? '/compte/client/visites' : '/compte/connexion?next=%2Fcompte%2Fclient%2Fvisites'}
            className="u-press flex h-12 items-center justify-center rounded-xl bg-blue text-[0.9375rem] font-semibold text-white"
          >
            {t('appShell.visit.myVisits')}
          </Link>
          <Link href={`/listings/${listing.id}`} className="flex h-11 items-center justify-center text-[0.9375rem] font-semibold text-blue">
            {t('appShell.visit.backToListing')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={bound} className="mx-auto max-w-lg">
      <input type="hidden" name="return_to" value="app" />

      <div className="border-b border-line bg-surface px-4 pb-3 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-[1.25rem] font-bold text-ink">{t('appShell.visit.title')}</h1>
          <span className="u-tabular text-[0.8125rem] text-ink-45">{t('appShell.visit.step', { step })}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1.5" aria-hidden="true">
          <span className="h-1 rounded-full bg-blue" />
          <span className={`h-1 rounded-full transition-colors duration-300 ${step === 2 ? 'bg-blue' : 'bg-line'}`} />
        </div>
      </div>

      <div className="px-4 pb-32 pt-4">
        <ListingSummary listing={listing} />

        {error ? (
          <p role="alert" className="mt-4 rounded-xl bg-danger-tint px-3.5 py-3 text-[0.875rem] font-medium text-danger">
            {t(VISIT_ERROR_KEYS[error] || VISIT_ERROR_KEYS[1])}
          </p>
        ) : null}

        {/* Step 1 stays mounted on step 2 (hidden): its inputs carry the slot into the form. */}
        <div hidden={step !== 1} className="mt-5">
          <h2 className="mb-3 text-[1.0625rem] font-bold text-ink">{t('appShell.visit.chooseTitle')}</h2>
          <VisitSlotPicker propertyId={listing.id} name="preferred_slot_at" value={slot} onChange={setSlot} idPrefix={`${uid}slot`} />
          <p className="mt-4 text-[0.8125rem] text-ink-45">{t('appShell.visit.confirmNote')}</p>
        </div>

        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          {step === 2 ? (
            <m.div key="details" custom={dir} variants={slide} initial="enter" animate="center" className="mt-5 space-y-4">
              {slot ? (
                <div className="flex items-center gap-3 rounded-xl bg-blue-tint px-3.5 py-3">
                  <CalendarClock strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 flex-none text-blue" aria-hidden="true" />
                  <span className="flex-1 text-[0.9375rem] font-semibold text-ink">{formatVisitSlot(slot, locale)}</span>
                  <button type="button" onClick={() => go(1)} className="text-[0.875rem] font-semibold text-blue">
                    {t('appShell.visit.change')}
                  </button>
                </div>
              ) : null}
              <div>
                <h2 className="text-[1.0625rem] font-bold text-ink">{t('appShell.visit.detailsTitle')}</h2>
                <p className="mt-1 text-[0.8125rem] text-ink-45">{t('appShell.visit.detailsText')}</p>
              </div>
              <div>
                <label htmlFor={`${uid}name`} className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
                  {t('enquiry.nameOptional')}
                </label>
                <input
                  key={prefillKey}
                  id={`${uid}name`}
                  name="name"
                  autoComplete="name"
                  defaultValue={profile?.fullName || ''}
                  placeholder={t('enquiry.namePlaceholder')}
                  className={FIELD}
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
                fieldClassName="h-12 rounded-xl bg-surface"
                required
              />
            </m.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto flex max-w-lg gap-2">
          {step === 2 ? (
            <button
              type="button"
              onClick={() => go(1)}
              aria-label={t('appShell.back')}
              className="u-press flex h-12 w-12 flex-none items-center justify-center rounded-xl border border-line text-ink"
            >
              <ChevronLeft strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
          {step === 1 ? (
            <button
              type="button"
              disabled={!slot}
              onClick={() => go(2)}
              className="u-press h-12 flex-1 rounded-xl bg-blue px-4 text-[0.9375rem] font-semibold text-white disabled:bg-line disabled:text-ink-45"
            >
              {slot ? t('appShell.visit.continueWith', { slot: formatVisitSlot(slot, locale) }) : t('appShell.visit.continue')}
            </button>
          ) : (
            <button type="submit" disabled={!slot} className="u-press h-12 flex-1 rounded-xl bg-blue px-4 text-[0.9375rem] font-semibold text-white disabled:opacity-50">
              {t('appShell.visit.submit')}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
