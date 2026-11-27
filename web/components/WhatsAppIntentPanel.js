'use client';

import { useState } from 'react';
import { ArrowLeft, CalendarClock, ChevronRight, CircleHelp, MapPin, MessageCircle, Video } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import PhoneField from '@/components/PhoneField';
import { normalizePhone } from '@/lib/phone';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { ICON_STROKE_WIDTH } from '@/lib/iconStyle';
import { useLocale, useT } from '@/lib/i18n/client';
import { VISIT_CONTACT_STORAGE_KEY, cleanVisitName, isVisitIntent } from '@/lib/visitContact';
import { isLoggedInClient } from '@/lib/customerClient';

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

function readStoredContact() {
  try {
    const raw = window.localStorage.getItem(VISIT_CONTACT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function storeContact(contact) {
  try {
    window.localStorage.setItem(VISIT_CONTACT_STORAGE_KEY, JSON.stringify(contact));
  } catch {
    // Private mode or blocked storage: the next visit asks again, nothing else changes.
  }
}

/**
 * The sheet behind a listing's WhatsApp button (components/WhatsAppIntentSheet.js
 * keeps the button, the routing, the tap logging and the « message parti ? »
 * card). Split out on 2026-11-21 and loaded with next/dynamic: with Radix Sheet
 * and PhoneField (country list, Popover) it was ~15 KB gzip on every page that
 * shows a listing card, before anyone tapped. Steps, copy and behaviour are the
 * ones the button carried: intent → (visit mode when the agent takes video
 * visits) → optional name + number → WhatsApp.
 *
 * @param {{open: boolean, onOpenChange: (open: boolean) => void, who: string,
 *   videoOffered: boolean, onGo: (intent: string, contact?: {name: string, phone: string}) => void}} props
 */
export default function WhatsAppIntentPanel({ open, onOpenChange, who, videoOffered, onGo }) {
  const t = useT();
  const locale = useLocale();
  const [step, setStep] = useState('intent');
  const [pendingIntent, setPendingIntent] = useState(null);
  const [contactError, setContactError] = useState(null);
  const [stored, setStored] = useState(null);

  function show(next) {
    onOpenChange(next);
    if (!next) {
      setStep('intent');
      setContactError(null);
    }
  }

  function go(intent, contact = null) {
    setStep('intent');
    setContactError(null);
    onGo(intent, contact);
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
    // "Créer mon compte gratuit" (2026-11-24): the button's go() opens the
    // account in the same tap (WhatsAppIntentSheet.js, whatsappAccountActions.js).
    go(pendingIntent, { name, phone, openAccount: form.get('openAccount') === '1' });
  }

  const titleKey = step === 'visitMode'
    ? 'listings.waIntent.visitMode.title'
    : step === 'contact' ? 'listings.waIntent.contact.title' : 'listings.waIntent.title';
  const lead = step === 'visitMode'
    ? t('listings.waIntent.visitMode.lead')
    : step === 'contact' ? t('listings.waIntent.contact.lead', { who }) : t('listings.waIntent.lead', { who });

  return (
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
  );
}
