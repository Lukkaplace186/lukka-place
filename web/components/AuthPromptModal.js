'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { useT } from '@/lib/i18n/client';

// Keys, not text — see components/navItems.js.
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
  const [phone, setPhone] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    const params = new URLSearchParams();
    params.set('next', next);
    if (phone.trim()) params.set('phone', phone.trim());
    router.push(`/compte/inscription?${params.toString()}`);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="gap-5 p-6">
        <DialogTitle className="text-left font-display text-lg font-normal leading-snug tracking-[-0.01em] text-ink">
          {TITLE_KEYS[trigger] || TITLES.save}
        </DialogTitle>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label htmlFor="auth-prompt-phone" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              {t('auth.phoneNumber')}
            </label>
            <input
              id="auth-prompt-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder={t('enquiry.whatsappPlaceholder')}
              autoFocus
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm text-ink"
            />
          </div>

          <button
            type="submit"
            className="u-press u-btn-primary mt-1 rounded-md bg-blue py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep"
          >
            Continuer
          </button>
        </form>

        <p className="text-center text-sm text-ink-45">
          Déjà un compte ?{' '}
          <Link href={`/compte/connexion?next=${encodeURIComponent(next)}`} className="font-semibold text-blue-deep hover:underline">
            {t('common.shared.signIn')}
          </Link>
        </p>
      </DialogContent>
    </Dialog>
  );
}
