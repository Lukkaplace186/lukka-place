'use client';

import dynamic from 'next/dynamic';
import { Check } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { trackCustomerSignup } from '@/lib/analyticsClient';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

const WhatsAppSignInForm = dynamic(() => import('@/app/(site)/compte/connexion/WhatsAppSignInForm'), { ssr: false });

const PERKS = ['listings.contactSignup.perkSaved', 'listings.contactSignup.perkAlerts'];
// With a "homes like this one" search (2026-11-24): the alert first, it is the promise.
const SIMILAR_PERKS = ['listings.contactSignup.perkSimilar', 'listings.contactSignup.perkSaved'];

/**
 * The sheet ContactSignupPrompt opens after a guest's WhatsApp tap (rules and
 * history there). Its own chunk since 2026-11-22: the prompt is mounted on
 * every public page, and this sheet brought the Radix dialog library into
 * every first load for the few visitors who come back from WhatsApp. The
 * prompt fetches it on the tap, while the visitor is in WhatsApp.
 *
 * `offer` (2026-11-24): `similar` when signing in lands on "homes like this
 * one" with the alert saved; `name` / `phone` typed in the visit sheet,
 * already in the form.
 */
export default function ContactSignupSheet({ open, onOpenChange, next, entry, offer = null }) {
  const similar = Boolean(offer?.similar);
  const knownPhone = offer?.phone || null;
  const t = useT();
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
            <SheetTitle className="text-lg font-semibold text-ink">{t(similar ? 'listings.contactSignup.titleSimilar' : 'listings.contactSignup.title')}</SheetTitle>
            <SheetDescription className="text-sm text-ink-70">{t(knownPhone ? 'listings.contactSignup.leadKnown' : 'listings.contactSignup.lead')}</SheetDescription>
          </SheetHeader>
          <ul className="flex flex-col gap-1.5">
            {(similar ? SIMILAR_PERKS : PERKS).map((key) => (
              <li key={key} className="flex items-start gap-2 text-sm text-ink-70">
                <Check strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-green-deep" aria-hidden="true" />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
          {open ? (
            <WhatsAppSignInForm
              next={next}
              entry={entry}
              defaultE164={knownPhone}
              defaultName={offer?.name || ''}
              onSubmit={() => trackCustomerSignup('prompt_open', entry)}
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
