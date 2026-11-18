'use client';

import { useEffect } from 'react';
import { trackCustomerSignup } from '@/lib/analyticsClient';
import { entryForPromptTrigger } from '@/lib/signupFunnelRules';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import QuickSignup from './QuickSignup';
import { useT } from '@/lib/i18n/client';

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

// Why an account, in the visitor's terms (2026-11-18), one line per trigger.
const WHY_KEYS = {
  save: 'listings.authPrompt.saveWhy',
  alert: 'listings.authPrompt.alertWhy',
  favorite: 'listings.authPrompt.favoriteWhy',
};

/**
 * Rightmove-style auth gate for the ♥ (FavoriteButton), "Sauvegarder la
 * recherche" and "Créer une alerte" (SaveSearchButton, QueryAlertButton).
 *
 * Since 2026-11-18 the account is created right here (components/QuickSignup.js:
 * name, number, password — the same form and action as /compte/inscription),
 * instead of a number field that sent the visitor to the sign-up page to type
 * it again with the rest. "Already have an account? Sign in" still goes to the
 * login page.
 *
 * `next` (passed in by the caller) carries both the return URL and the
 * `lkp_auth_return` / favourite-resume marker: signupAction redirects there
 * with a session, and SaveSearchButton / FavoriteResumeHandler then perform
 * the save that was asked. This modal never saves anything itself.
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
      <DialogContent className="max-h-[92dvh] gap-4 overflow-y-auto p-6">
        <DialogTitle className="text-left font-bold text-lg leading-snug tracking-[-0.01em] text-ink">
          {t(TITLE_KEYS[trigger] || TITLE_KEYS.save)}
        </DialogTitle>
        <DialogDescription className="text-left text-sm text-ink-70">
          {t(WHY_KEYS[trigger] || WHY_KEYS.save)}
        </DialogDescription>
        {open ? <QuickSignup next={next} entry={entry} idPrefix={`auth-prompt-${trigger || 'save'}-`} autoFocusName /> : null}
      </DialogContent>
    </Dialog>
  );
}
