import { getT } from '@/lib/i18n/server';
import { activateCustomerAction } from './actions';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('auth.activateCustomer.metaTitle'), robots: { index: false, follow: false } };
}

const ERRORS = {
  invalid: 'auth.activateCustomer.errors.invalid',
  password: 'auth.errors.passwordMin8',
  mismatch: 'auth.activateCustomer.errors.mismatch',
};

/**
 * The link in the WhatsApp welcome message (engine
 * services/customerOnboarding.js): choose a password, then the Espace
 * Client opens. Public in middleware.js — it comes before any session — and
 * guarded by the single-use token in its own URL.
 */
export default async function ActivateCustomerPage({ searchParams }) {
  const t = await getT();
  const params = await searchParams;
  const phone = typeof params.phone === 'string' ? params.phone : '';
  const token = typeof params.token === 'string' ? params.token : '';
  const error = typeof params.error === 'string' ? ERRORS[params.error] : null;
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="u-lift w-full max-w-sm rounded-card border border-line bg-surface p-6 sm:p-8">
        <h1 className="u-title-section text-ink">{t('auth.activateCustomer.title')}</h1>
        <p className="mt-1 text-sm text-ink-45">{t('auth.activateCustomer.lead')}</p>
        <form action={activateCustomerAction} className="mt-6 flex flex-col gap-3">
          <input type="hidden" name="phone" value={phone} />
          <input type="hidden" name="token" value={token} />
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-ink-45">
            {t('auth.password')}
            <input type="password" name="password" autoComplete="new-password" minLength={8} required className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-ink-45">
            {t('auth.activateCustomer.confirm')}
            <input type="password" name="password_confirm" autoComplete="new-password" minLength={8} required className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink" />
          </label>
          {error ? <p className="text-sm text-red-600" role="alert">{t(error)}</p> : null}
          <button type="submit" className="u-btn-primary mt-1 rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-deep">
            {t('auth.activateCustomer.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
