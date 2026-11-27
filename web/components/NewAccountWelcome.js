'use client';

import { useEffect, useState } from 'react';
import Link from '@/components/LocaleLink';
import { CheckCircle2, X } from 'lucide-react';
import { WELCOME_COOKIE } from '@/lib/newAccountWelcome';
import { ICON_STROKE_WIDTH } from '@/lib/iconStyle';
import { useT } from '@/lib/i18n/client';

const SHOWN_FOR_MS = 12 * 1000;

/**
 * "Bienvenue Henoc ! Votre compte est créé" (owner, 2026-11-24: a name and a
 * number now open an account at once, and the customer must be told). Shown
 * once, on the page they land on, after "Continuer" with a new number or the
 * WhatsApp sheet's account box. The site layout passes `name` from the
 * `lukka_welcome` cookie (lib/newCustomerSession.js); the card clears it as it
 * appears, so a reload never says it twice. `null` = nothing to say.
 *
 * Fixed under the header like the sign-up nudge (which never shows to a
 * signed-in visitor, so the two never meet). Leaves by itself after 12 s
 * on screen — counted only while the tab is visible, since the WhatsApp
 * sheet's account is opened while they are in WhatsApp.
 *
 * @param {{name: string|null}} props '' = an account without a usable first name
 */
export default function NewAccountWelcome({ name }) {
  const t = useT();
  const [shown, setShown] = useState(null);

  useEffect(() => {
    if (name === null || name === undefined) return;
    try {
      document.cookie = `${WELCOME_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;
    } catch {
      // Cookies blocked: it may show once more, nothing else.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shown in response to the server's cookie
    setShown(name);
  }, [name]);

  useEffect(() => {
    if (shown === null) return undefined;
    let left = SHOWN_FOR_MS;
    let last = Date.now();
    const tick = setInterval(() => {
      const now = Date.now();
      if (document.visibilityState === 'visible') left -= now - last;
      last = now;
      if (left <= 0) setShown(null);
    }, 500);
    return () => clearInterval(tick);
  }, [shown]);

  if (shown === null) return null;
  return (
    <div
      className="fixed inset-x-3 top-[4.5rem] z-[56] mx-auto flex max-w-xl items-start gap-3 rounded-card border border-green/30 bg-surface p-3 shadow-lg"
      role="status"
      aria-live="polite"
    >
      <CheckCircle2 strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-5 w-5 shrink-0 text-green-deep" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="u-micro-strong text-ink">
          {shown ? t('auth.whatsappSignIn.welcomeTitle', { name: shown }) : t('auth.whatsappSignIn.welcomeTitleNoName')}
        </p>
        <p className="u-micro text-ink-70">{t('auth.whatsappSignIn.welcomeBody')}</p>
        <Link href="/compte/client" className="u-micro-strong u-hit relative mt-1.5 inline-block text-blue-deep underline">
          {t('auth.whatsappSignIn.welcomeCta')}
        </Link>
      </div>
      <button
        type="button"
        onClick={() => setShown(null)}
        aria-label={t('auth.whatsappSignIn.welcomeClose')}
        className="u-hit relative shrink-0 rounded p-1 text-ink-45 hover:text-ink"
      >
        <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
      </button>
    </div>
  );
}
