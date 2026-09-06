import Link from 'next/link';
import { agentLoginAction } from './actions';
import { getT } from '@/lib/i18n/server';

export const metadata = {
  title: 'Connexion agent — Lukka Place',
  robots: { index: false, follow: false },
};

// Keys, not text: a module-level constant is evaluated once at import
// and cannot hold translated copy — see components/navItems.js. The
// lookup below resolves the key at render.
const ERROR_MESSAGE_KEYS = {
  1: 'auth.errors.badCredentials',
  phone: 'auth.errors.phoneInvalid',
  locked: 'auth.errors.locked',
  otp_failed: 'auth.errors.otpFailed',
};

/**
 * Plain HTML form, no client wrapper — unlike the customer LoginForm.js,
 * there's no localStorage anonymous-data merge to carry across submit here.
 */
export default async function AgentLoginPage({ searchParams }) {
  const t = await getT();
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const reset = params.reset === '1';
  const next = typeof params.next === 'string' ? params.next : '/compte/agent';

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 u-lift sm:p-8">
        <h1 className="u-title-section text-ink">{t('agent.nav.eyebrow')}</h1>
        <p className="mt-1 text-sm text-ink-45">{t('auth.agentLoginLead')}</p>

        <form action={agentLoginAction} className="mt-6 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />

          <div>
            <label htmlFor="phone" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              {t('auth.phoneNumber')}
            </label>
            <input
              id="phone"
              type="tel"
              name="phone"
              inputMode="tel"
              autoComplete="tel"
              placeholder={t('enquiry.whatsappPlaceholder')}
              autoFocus
              required
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-wide text-ink-45">
                {t('auth.password')}
              </label>
              <Link href="/mot-de-passe-oublie?role=agent" className="text-xs font-semibold text-blue-deep hover:underline">
                {t('account.profile.forgotPassword')}
              </Link>
            </div>
            <input
              id="password"
              type="password"
              name="password"
              autoComplete="current-password"
              required
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
            />
          </div>

          {reset && (
            <p className="text-sm text-green-deep" role="status">
              {t('auth.passwordReset')}
            </p>
          )}

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {(ERROR_MESSAGE_KEYS[error] ? t(ERROR_MESSAGE_KEYS[error]) : null) || (ERROR_MESSAGE_KEYS[1] ? t(ERROR_MESSAGE_KEYS[1]) : null)}
            </p>
          )}

          <button
            type="submit"
            className="mt-1 rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
          >
            {t('admin.login.submit')}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-45">
          Pas encore de compte agent ?{' '}
          <Link
            href={`/compte/agent/inscription?next=${encodeURIComponent(next)}`}
            className="font-semibold text-blue-deep hover:underline"
          >
            {t('common.actions.signup')}
          </Link>
        </p>
      </div>
    </div>
  );
}
