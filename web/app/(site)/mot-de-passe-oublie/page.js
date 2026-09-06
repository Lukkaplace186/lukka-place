import Link from 'next/link';
import { requestResetAction } from './actions';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import PhoneField from '@/components/PhoneField';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { getRequestCountry } from '@/lib/requestCountry';
import { getLocale, getT } from '@/lib/i18n/server';

// generateMetadata, not a static object: a static export cannot see the
// request locale — see app/(site)/a-propos/page.js.
export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('auth.forgotPasswordMetaTitle'),
    robots: { index: false, follow: false },
  };
}

// Keys, not text: a module-level constant is evaluated once at import
// and cannot hold translated copy — see components/navItems.js. The
// lookup below resolves the key at render.
const ERROR_MESSAGE_KEYS = {
  phone: 'auth.errors.phoneInvalid',
  send_failed: 'auth.errors.sendFailed',
};

/**
 * Step 1 of 2 (see ./verifier/page.js). Deliberately doesn't prefill the
 * phone field from a query param on error — same convention
 * compte/inscription's SignupForm.js already uses (no prefill there either)
 * and it keeps a real phone number out of the URL even on the failure path.
 */
export default async function ForgotPasswordPage({ searchParams }) {
  const t = await getT();
  const locale = await getLocale();
  const country = await getRequestCountry();
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const role = params.role === 'agent' ? 'agent' : 'customer';

  const whatsappHref = getCentralWhatsAppHref(
    t('auth.forgot.whatsappHelp'),
  );

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 u-lift sm:p-8">
        <h1 className="u-title-section text-ink">{t('auth.forgotPassword')}</h1>
        <p className="mt-1 text-sm text-ink-45">
          {t('auth.forgot.lead')}
        </p>

        <form action={requestResetAction} className="mt-6 flex flex-col gap-3">
          <PhoneField
            name="phone"
            id="phone"
            defaultCountry={country}
            locale={locale}
            labels={phoneFieldLabels(t)}
            autoFocus
            required
          />

          <fieldset>
            <legend className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">Je suis</legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-sm text-ink-70">
                <input type="radio" name="role" value="customer" defaultChecked={role === 'customer'} className="accent-blue" />
                Client
              </label>
              <label className="flex items-center gap-1.5 text-sm text-ink-70">
                <input type="radio" name="role" value="agent" defaultChecked={role === 'agent'} className="accent-blue" />
                Agent
              </label>
            </div>
          </fieldset>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {(ERROR_MESSAGE_KEYS[error] ? t(ERROR_MESSAGE_KEYS[error]) : null) || t('common.shared.somethingWentWrong')}
            </p>
          )}

          <button
            type="submit"
            className="mt-1 rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
          >
            {t('auth.forgot.receiveCode')}
          </button>
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
          <Link href="/compte/connexion" className="font-semibold text-blue-deep hover:underline">
            {t('auth.forgot.backToLogin')}
          </Link>
        </p>
      </div>
    </div>
  );
}
