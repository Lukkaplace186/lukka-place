'use client';

import { useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Check, Loader2 } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

// How long "✓ Enregistré" stays on screen before the page goes back.
export const SAVED_RETURN_MS = 700;

/**
 * The submit button of every Réglages form (2026-09-28). Agents saved a
 * section and were left on it with a line of green text, not knowing whether
 * to press Back. Now:
 *
 * 1. while the Server Action runs, the button says "Enregistrement…";
 * 2. the action redirects back with `?saved=<section>` and the page renders
 *    this button with `done` — it turns into "✓ Enregistré";
 * 3. SAVED_RETURN_MS later it replaces the URL with `returnTo` (the Réglages
 *    index). On a phone that is the section list, one level up; on a desktop
 *    every card is already on screen, so the only visible change is the
 *    button settling back and the `?saved=` leaving the address bar.
 *
 * `replace`, not `push`: Back from the index must not reopen the section with
 * its "saved" state replayed.
 */
export default function SettingsSaveButton({ children, className, done = false, doneLabel, returnTo = '/compte/agent/parametres' }) {
  const t = useT();
  const router = useRouter();
  const { pending } = useFormStatus();

  useEffect(() => {
    if (!done) return undefined;
    const timer = setTimeout(() => router.replace(returnTo, { scroll: false }), SAVED_RETURN_MS);
    return () => clearTimeout(timer);
  }, [done, returnTo, router]);

  if (done && !pending) {
    return (
      <button
        type="submit"
        className={`${className} u-pop pointer-events-none !bg-success !text-white`}
        aria-disabled="true"
      >
        <span role="status" className="inline-flex items-center justify-center gap-1.5">
          <Check strokeWidth={3} className="h-4 w-4" aria-hidden="true" />
          {doneLabel || t('agent.settings.savedShort')}
        </span>
      </button>
    );
  }

  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={`${className} disabled:opacity-80`}>
      {pending ? (
        <span className="inline-flex items-center justify-center gap-1.5">
          <Loader2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('common.actions.saving')}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
