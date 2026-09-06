import Link from 'next/link';
import { agentSignupAction } from './actions';
import { getT } from '@/lib/i18n/server';

// generateMetadata, not a static object: a static export cannot see the
// request locale — see app/(site)/a-propos/page.js.
export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('auth.agentSignupMetaTitle'),
    robots: { index: false, follow: false },
  };
}

// Keys, not text: a module-level constant is evaluated once at import
// and cannot hold translated copy — see components/navItems.js. The
// lookup below resolves the key at render.
const ERROR_MESSAGE_KEYS = {
  name: 'auth.errors.nameRequired',
  phone: 'auth.errors.phoneInvalid',
  password: 'auth.errors.passwordMin8',
  exists: 'auth.errors.accountExists',
  otp_failed: 'auth.errors.otpFailed',
};

export default async function AgentSignupPage({ searchParams }) {
  const t = await getT();
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const next = typeof params.next === 'string' ? params.next : '/compte/agent';

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 u-lift sm:p-8">
        <h1 className="u-title-section text-ink">{t('auth.agentSignupTitle')}</h1>
        <p className="mt-1 text-sm text-ink-45">
          {t('auth.signup.codeWillBeSent')}
        </p>

        <form action={agentSignupAction} className="mt-6 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />

          <div>
            <label htmlFor="full_name" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              {t('account.profile.fullName')}
            </label>
            <input
              id="full_name"
              type="text"
              name="full_name"
              autoComplete="organization"
              placeholder="Ex. Espace Kin Immobilier"
              autoFocus
              required
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
            />
          </div>

          <div>
            <label htmlFor="phone" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              {t('agent.settings.whatsappNumber')}
            </label>
            <input
              id="phone"
              type="tel"
              name="phone"
              inputMode="tel"
              autoComplete="tel"
              placeholder={t('enquiry.whatsappPlaceholder')}
              required
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              {t('auth.password')}
            </label>
            <input
              id="password"
              type="password"
              name="password"
              autoComplete="new-password"
              minLength={8}
              required
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {(ERROR_MESSAGE_KEYS[error] ? t(ERROR_MESSAGE_KEYS[error]) : null) || ERROR_MESSAGES.phone}
            </p>
          )}

          <button
            type="submit"
            className="mt-1 rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
          >
            {t('auth.signup.receiveCode')}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-45">
          Déjà un compte ?{' '}
          <Link
            href={`/compte/agent/connexion?next=${encodeURIComponent(next)}`}
            className="font-semibold text-blue-deep hover:underline"
          >
            {t('admin.login.submit')}
          </Link>
        </p>
      </div>
    </div>
  );
}
