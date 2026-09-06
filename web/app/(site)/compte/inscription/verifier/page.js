import Link from 'next/link';
import { redirect } from 'next/navigation';
import { customerVerifyOtpAction, customerResendOtpAction } from './actions';
import ResendButton from '@/components/OtpResendButton';
import { getVerifyAttempt, maskPhone } from '@/lib/verifyAttempt';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { getT } from '@/lib/i18n/server';

// generateMetadata, not a static object: a static export cannot see the
// request locale — see app/(site)/a-propos/page.js.
export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('auth.verifyMetaTitle'),
    robots: { index: false, follow: false },
  };
}

// Keys, not text: a module-level constant is evaluated once at import
// and cannot hold translated copy — see components/navItems.js.
const ERROR_MESSAGE_KEYS = {
  1: 'auth.errors.codeInvalid',
  expired: 'auth.errors.codeExpired',
  send_failed: 'auth.errors.sendFailed',
};

/**
 * Step 2 of customer signup. Reachable only with a valid attempt cookie —
 * anyone landing here without one (a bookmarked URL, an expired flow) is
 * sent back to step 1 rather than shown a code box that can never succeed.
 */
export default async function CustomerVerifyOtpPage({ searchParams }) {
  const t = await getT();
  const params = await searchParams;
  const attempt = await getVerifyAttempt();

  if (!attempt || attempt.role !== 'customer') {
    redirect('/compte/inscription?error=expired_attempt');
  }

  const error = typeof params.error === 'string' ? params.error : null;
  const sent = params.sent === '1';
  const next = typeof params.next === 'string' ? params.next : '/compte/client';
  const whatsappHref = getCentralWhatsAppHref(t('auth.forgot.whatsappCodeHelp'));

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 u-lift sm:p-8">
        <h1 className="u-title-section text-ink">{t('auth.numberVerification')}</h1>
        <p className="mt-1 text-sm text-ink-45">
          {t('auth.codeSentTo', { phone: maskPhone(attempt.phone) })}
          {sent ? ` ${t('auth.newCodeSent')}` : ''}
        </p>

        <form action={customerVerifyOtpAction} className="mt-6 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />

          {/* autoComplete="one-time-code": on iOS and Android the code is
              offered straight from the WhatsApp notification, so the usual
              copy-switch-app-paste round trip disappears. */}
          <div>
            <label htmlFor="code" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              {t('auth.verificationCode')}
            </label>
            <input
              id="code"
              type="text"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              autoFocus
              required
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-center text-lg tracking-[0.3em] text-ink"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {(ERROR_MESSAGE_KEYS[error] ? t(ERROR_MESSAGE_KEYS[error]) : null) || t(ERROR_MESSAGE_KEYS[1])}
            </p>
          )}

          <button
            type="submit"
            className="mt-1 rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
          >
            {t('auth.verify')}
          </button>
        </form>

        <form action={customerResendOtpAction} className="mt-3 text-center">
          <input type="hidden" name="next" value={next} />
          <ResendButton key={sent ? 'sent' : 'initial'} />
        </form>

        {error === 'send_failed' && whatsappHref && (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="u-btn-secondary mt-3 flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-ink-70"
          >
            {t('auth.forgot.contactSupport')}
          </a>
        )}

        <p className="mt-5 text-center text-sm text-ink-45">
          <Link href="/compte/inscription" className="font-semibold text-blue-deep hover:underline">
            {t('auth.wrongNumber')}
          </Link>
        </p>
      </div>
    </div>
  );
}
