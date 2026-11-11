import Link from 'next/link';
import { loginAction } from './actions';
import LoginForm from './LoginForm';
import { getRequestCountry } from '@/lib/requestCountry';
import { getT } from '@/lib/i18n/server';
import { getRememberedCustomerPhone } from '@/lib/customerSession';
import { splitPhone } from '@/lib/phone';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('auth.customerLoginMetaTitle'), robots: { index: false, follow: false } };
}

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
  const country = await getRequestCountry();
  // The number that last signed in on this device (lib/customerSession.js):
  // coming back is the password and nothing else.
  const remembered = splitPhone(await getRememberedCustomerPhone());

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

        <LoginForm
          action={loginAction}
          next={next}
          error={error}
          defaultCountry={remembered.country || country}
          defaultPhone={remembered.country ? remembered.national : ''}
          // From sign-up's "Se connecter avec ce numéro": this device's move
          // answers become a project once signed in.
          withProject={params.apres === 'projet'}
        />

        <p className="mt-5 text-center text-sm text-ink-45">
          {t('auth.noAccountYet')}{' '}
          <Link href={`/compte/inscription?next=${encodeURIComponent(next)}&entree=login_page`} className="font-semibold text-blue-deep hover:underline">
            {t('common.actions.signup')}
          </Link>
        </p>
      </div>
    </div>
  );
}
