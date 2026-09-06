import Link from 'next/link';
import { loginAction } from './actions';
import LoginForm from './LoginForm';
import { getT } from '@/lib/i18n/server';

export const metadata = {
  title: 'Connexion — Lukka Place',
  robots: { index: false, follow: false },
};

/**
 * Same shape as app/admin/login/page.js — errors read back via ?error=,
 * redirect target via ?next=. Middleware sends visitors here with
 * ?next=<original path> when they hit a gated /compte/* route while logged
 * out.
 */
export default async function CustomerLoginPage({ searchParams }) {
  const t = await getT();
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const reset = params.reset === '1';
  const next = typeof params.next === 'string' ? params.next : '/compte/client';

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 u-lift sm:p-8">
        <h1 className="u-title-section text-ink">{t('common.actions.login')}</h1>
        <p className="mt-1 text-sm text-ink-45">{t('auth.customerLoginLead')}</p>

        {reset && (
          <p className="mt-4 text-sm text-green-deep" role="status">
            {t('auth.passwordReset')}
          </p>
        )}

        <LoginForm action={loginAction} next={next} error={error} />

        <p className="mt-5 text-center text-sm text-ink-45">
          Pas encore de compte ?{' '}
          <Link href={`/compte/inscription?next=${encodeURIComponent(next)}`} className="font-semibold text-blue-deep hover:underline">
            {t('common.actions.signup')}
          </Link>
        </p>
      </div>
    </div>
  );
}
