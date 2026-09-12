'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import PhoneField from './PhoneField';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { useLocale, useT } from '@/lib/i18n/client';

/*
 * Keys, not text — see components/navItems.js. They must be RESOLVED through
 * `t()` at the render site below: an earlier version interpolated the key
 * itself into the dialog heading, so a guest tapping the heart read the
 * literal string "listings.authPrompt.favorite". Caught in real mobile QA.
 * The same line also referenced an undefined `TITLES` as its fallback, which
 * a trigger outside this map would have evaluated — a ReferenceError thrown
 * during render, i.e. Next.js's "This page couldn't load" boundary on top of
 * a page that was fine a moment earlier. `TITLE_KEYS.save` is the real
 * fallback the rename left behind.
 */
const TITLE_KEYS = {
  save: 'listings.authPrompt.save',
  alert: 'listings.authPrompt.alert',
  favorite: 'listings.authPrompt.favorite',
};

/**
 * Rightmove-style auth gate for SaveSearchButton's guest path.
 *
 * This app's real customer accounts are phone + password
 * (lib/customerAuth.js) — there is no email field anywhere in the schema, so
 * this asks for the same real phone number field /compte/inscription itself
 * collects, not an email address the backend has nowhere to put.
 *
 * "Continuer" hands off to the real signup page with the phone prefilled.
 * `next` (passed in by the caller) already carries both the return URL and a
 * `lkp_auth_return` marker — SaveSearchButton reads that marker back once
 * the visitor lands here again with a genuine session, and only then
 * performs the actual save. See SaveSearchButton.js's own doc comment for
 * the full round trip; this modal never saves anything itself.
 */
export default function AuthPromptModal({ open, onClose, trigger, next }) {
  const t = useT();
  const router = useRouter();
  const locale = useLocale();

  // Read straight off the form rather than from controlled state: PhoneField
  // owns two values (the typed number and the picked country) and both have
  // to reach the signup page, or the country the visitor chose here is lost
  // and their number gets re-guessed as a DRC one on the next screen.
  function handleSubmit(e) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const phone = String(data.get('phone') || '').trim();
    const country = String(data.get('phoneCountry') || '');

    const params = new URLSearchParams();
    params.set('next', next);
    if (phone) params.set('phone', phone);
    if (phone && country) params.set('country', country);
    router.push(`/compte/inscription?${params.toString()}`);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="gap-5 p-6">
        <DialogTitle className="text-left font-display text-lg font-normal leading-snug tracking-[-0.01em] text-ink">
          {t(TITLE_KEYS[trigger] || TITLE_KEYS.save)}
        </DialogTitle>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <PhoneField
            name="phone"
            id="auth-prompt-phone"
            locale={locale}
            labels={phoneFieldLabels(t)}
            autoFocus
            required
          />

          <button
            type="submit"
            className="u-press u-btn-primary mt-1 rounded-md bg-blue py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep"
          >
            {t('listings.authPrompt.continue')}
          </button>
        </form>

        <p className="text-center text-sm text-ink-45">
          {t('listings.authPrompt.alreadyHaveAccount')}{' '}
          <Link href={`/compte/connexion?next=${encodeURIComponent(next)}`} className="font-semibold text-blue-deep hover:underline">
            {t('common.shared.signIn')}
          </Link>
        </p>
      </DialogContent>
    </Dialog>
  );
}
