'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, Loader2 } from 'lucide-react';
import { checkWhatsAppVerificationAction } from '@/app/(site)/compte/whatsappVerifyActions';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

const POLL_MS = 3000;

/**
 * "Vérifier via WhatsApp": the person sends the code shown here from their own
 * WhatsApp; the engine matches it on their number (lib/whatsappVerify.js).
 *
 * Polls while the page is visible and checks at once when it becomes visible
 * again — on a phone the person leaves for WhatsApp and comes back, and that
 * return is exactly when the answer is ready.
 */
export default function WhatsAppVerifyPanel({ code, href, maskedPhone, next, restartHref }) {
  const t = useT();
  const router = useRouter();
  const [status, setStatus] = useState('pending');
  const busy = useRef(false);

  const check = useCallback(async () => {
    if (busy.current || document.visibilityState !== 'visible') return;
    busy.current = true;
    try {
      const result = await checkWhatsAppVerificationAction(next);
      if (result.status === 'verified') {
        setStatus('verified');
        router.replace(result.href);
      } else if (result.status === 'expired') {
        setStatus('expired');
      }
    } catch {
      // A dropped request on a weak connection: the next tick asks again.
    } finally {
      busy.current = false;
    }
  }, [next, router]);

  useEffect(() => {
    if (status !== 'pending') return undefined;
    const timer = setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [check, status]);

  if (status === 'expired') {
    return (
      <p className="mt-4 text-sm text-ink-70" role="alert">
        {t('auth.whatsappVerify.expired')}{' '}
        <Link href={restartHref} className="font-semibold text-blue-deep hover:underline">
          {t('auth.whatsappVerify.restart')}
        </Link>
      </p>
    );
  }

  return (
    <div className="mt-5">
      <p className="text-sm text-ink-70">{t('auth.whatsappVerify.intro', { phone: maskedPhone })}</p>
      <p className="u-tabular mt-4 rounded-md border border-line bg-canvas px-3 py-3 text-center text-2xl font-bold tracking-[0.35em] text-ink">
        {code}
      </p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          {t('auth.whatsappVerify.send')}
        </a>
      ) : (
        <p className="mt-4 text-sm text-red-600">{t('auth.whatsappVerify.noNumber')}</p>
      )}
      <p aria-live="polite" className="mt-4 flex items-center justify-center gap-2 text-[0.8125rem] text-ink-45">
        {status === 'verified' ? (
          <>
            <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-green-deep" aria-hidden="true" />
            {t('auth.whatsappVerify.verified')}
          </>
        ) : (
          <>
            <Loader2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t('auth.whatsappVerify.waiting')}
          </>
        )}
      </p>
      <p className="mt-2 text-center text-[0.75rem] text-ink-45">{t('auth.whatsappVerify.hint')}</p>
    </div>
  );
}
