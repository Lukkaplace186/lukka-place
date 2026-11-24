'use client';

import { useEffect } from 'react';
import Link from '@/components/LocaleLink';
import { BellRing } from 'lucide-react';
import { WhatsAppIcon } from '@/components/WhatsAppCTA';
import { proveAccountHref } from '@/lib/guestAccountRules';
import { trackCustomerSignup } from '@/lib/analyticsClient';
import { withSignupEntry } from '@/lib/signupFunnelRules';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

/**
 * Under a request's or a visit's confirmation (2026-11-24): the free account
 * the same name and number just opened (lib/guestAccount.js), one tap from
 * being theirs.
 *
 * - `created`: "Votre compte gratuit est créé" → the code screen (send the code
 *   from WhatsApp, signed in);
 * - `existing`: the number already has an account → the same screen signs them in;
 * - `offer`: no account was opened (no name given) → "Continuer avec WhatsApp"
 *   on the sign-in page, which asks the name once.
 *
 * Anything else renders nothing (signed in, box unticked, demo number).
 */
export default function AccountOfferCard({ status, next = '/compte/client', entry }) {
  const t = useT();
  const shown = status === 'created' || status === 'existing' || status === 'offer';

  useEffect(() => {
    if (shown) trackCustomerSignup('prompt_shown', entry);
  }, [shown, entry]);

  if (!shown) return null;
  const href = status === 'offer'
    ? withSignupEntry(`/compte/connexion?next=${encodeURIComponent(next)}`, entry)
    : proveAccountHref(status, next);

  return (
    <div className="mt-4 rounded-lg border border-blue/30 bg-blue-tint px-4 py-4 text-left">
      <p className="flex items-center gap-2 text-[0.9375rem] font-semibold text-ink">
        <BellRing strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-4 w-4 shrink-0 text-blue-deep" />
        {t(`listings.accountOffer.${status}.title`)}
      </p>
      <p className="mt-1 text-[0.8125rem] text-ink-70">{t(`listings.accountOffer.${status}.body`)}</p>
      <Link
        href={href}
        onClick={() => trackCustomerSignup('prompt_open', entry)}
        className="u-press mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[#1E7B54] px-4 text-[0.875rem] font-semibold text-white"
      >
        <WhatsAppIcon className="h-4 w-4" />
        {t(`listings.accountOffer.${status}.cta`)}
      </Link>
    </div>
  );
}
