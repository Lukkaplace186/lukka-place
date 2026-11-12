'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { trackCustomerSignup } from '@/lib/analyticsClient';
import { entryForPromptTrigger } from '@/lib/signupFunnelRules';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import WhatsAppSignInForm from '@/app/(site)/compte/connexion/WhatsAppSignInForm';
import { useT } from '@/lib/i18n/client';

/*
 * Keys, not text — see components/navItems.js. They must be RESOLVED through
 * `t()` at the render site below: an earlier version interpolated the key
 * itself into the dialog heading, so a guest tapping the heart read the
 * literal string "listings.authPrompt.favorite". Caught in real mobile QA.
 * `TITLE_KEYS.save` is the fallback for a trigger outside this map.
 */
const TITLE_KEYS = {
  save: 'listings.authPrompt.save',
  alert: 'listings.authPrompt.alert',
  favorite: 'listings.authPrompt.favorite',
  favoriteKeep: 'listings.authPrompt.favoriteKeep',
};

/** Why an account is needed for this, said at the moment it is asked (UX pass 2026-11-12). */
const REASON_KEYS = {
  save: 'listings.authPrompt.reasons.save',
  alert: 'listings.authPrompt.reasons.alert',
  favorite: 'listings.authPrompt.reasons.favorite',
  favoriteKeep: 'listings.authPrompt.reasons.favorite',
};

/**
 * The sign-in prompt for a guest who wants something an account is needed
 * for: an alert, a saved search, more saved homes. Since 2026-11-12 it says
 * WHY, then signs in or opens the account in one step with "Continuer avec
 * WhatsApp" (app/(site)/compte/connexion/WhatsAppSignInForm.js) — a code sent
 * from the person's own WhatsApp, no password. The password form stays one
 * tap away.
 *
 * `next` (passed in by the caller) carries the return URL and the caller's
 * resume marker (SaveSearchButton's `lkp_auth_return`, FavoriteButton's
 * FAV_RETURN_PARAM); the caller performs the actual save once the visitor
 * lands back with a genuine session. This modal never saves anything itself.
 */
export default function AuthPromptModal({ open, onClose, trigger, next }) {
  const t = useT();
  // The sign-up funnel (lib/signupFunnelRules.js): which prompt this is.
  const entry = entryForPromptTrigger(trigger);

  // Shown once per opening: the modal mounts only when a guest taps.
  useEffect(() => {
    if (open) trackCustomerSignup('prompt_shown', entry);
  }, [open, entry]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="gap-3 p-6">
        <DialogTitle className="text-left font-bold text-lg leading-snug tracking-[-0.01em] text-ink">
          {t(TITLE_KEYS[trigger] || TITLE_KEYS.save)}
        </DialogTitle>
        <p className="text-[0.9375rem] text-ink-70">{t(REASON_KEYS[trigger] || REASON_KEYS.save)}</p>

        <WhatsAppSignInForm next={next} entry={entry} onSubmit={() => trackCustomerSignup('prompt_open', entry)} />

        <p className="text-center text-sm text-ink-45">
          {t('auth.whatsappSignIn.preferPassword')}{' '}
          <Link href={`/compte/connexion?next=${encodeURIComponent(next)}`} className="font-semibold text-blue-deep hover:underline">
            {t('common.shared.signIn')}
          </Link>
        </p>
      </DialogContent>
    </Dialog>
  );
}
