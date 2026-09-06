import { agentVerifyOtpAction, agentResendOtpAction } from './actions';
import ResendButton from './ResendButton';
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
// and cannot hold translated copy — see components/navItems.js. The
// lookup below resolves the key at render.
const ERROR_MESSAGE_KEYS = {
  1: 'auth.errors.codeInvalid',
  expired: 'auth.errors.codeExpired',
};

export default async function AgentVerifyOtpPage({ searchParams }) {
  const t = await getT();
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const sent = params.sent === '1';
  const next = typeof params.next === 'string' ? params.next : '/compte/agent';
  const agentId = typeof params.agent === 'string' ? params.agent : '';

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 u-lift sm:p-8">
        <h1 className="u-title-section text-ink">{t('auth.numberVerification')}</h1>
        <p className="mt-1 text-sm text-ink-45">
          {t('auth.enterSixDigitCode')}
          {sent ? ` ${t('auth.newCodeSent')}` : ''}
        </p>

        <form action={agentVerifyOtpAction} className="mt-6 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="agent" value={agentId} />

          <div>
            <label htmlFor="code" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              {t('auth.verificationCode')}
            </label>
            <input
              id="code"
              type="text"
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoFocus
              required
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-center text-lg tracking-[0.3em] text-ink"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {(ERROR_MESSAGE_KEYS[error] ? t(ERROR_MESSAGE_KEYS[error]) : null) || (ERROR_MESSAGE_KEYS[1] ? t(ERROR_MESSAGE_KEYS[1]) : null)}
            </p>
          )}

          <button
            type="submit"
            className="mt-1 rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
          >
            {t('auth.verify')}
          </button>
        </form>

        <form action={agentResendOtpAction} className="mt-3 text-center">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="agent" value={agentId} />
          <ResendButton key={sent ? 'sent' : 'initial'} />
        </form>
      </div>
    </div>
  );
}
