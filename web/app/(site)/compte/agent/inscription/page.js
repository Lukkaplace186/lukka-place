import Link from 'next/link';
import { cookies } from 'next/headers';
import { agentSignupAction } from './actions';
import { normaliseReferralCode } from '@/lib/launchCommission';
import { findRepByReferralCode } from '@/lib/salesLaunch';
import { REFERRAL_COOKIE, parseReferralCookie } from '@/lib/salesReferral';
import PhoneField from '@/components/PhoneField';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { getRequestCountry } from '@/lib/requestCountry';
import { getLocale, getT } from '@/lib/i18n/server';
import { otpBypassEnabled } from '@/lib/otpBypass';

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
  agency: 'auth.errors.agencyNameRequired',
  phone: 'auth.errors.phoneInvalid',
  password: 'auth.errors.passwordMin8',
  exists: 'auth.errors.accountExists',
  otp_failed: 'auth.errors.otpFailed',
  ref: 'auth.errors.referralUnknown',
};

/**
 * The code to prefill: the referral this browser already carries (first valid
 * referral wins), else a well-formed `?ref=`. A remembered code whose rep is
 * no longer active is not offered — it would only be refused on submit.
 */
async function referralPrefill(refParam) {
  const cookieStore = await cookies();
  const remembered = parseReferralCookie(cookieStore.get(REFERRAL_COOKIE)?.value);
  if (remembered) {
    try {
      const rep = await findRepByReferralCode(remembered.code);
      if (rep?.status === 'active') return remembered.code;
    } catch (err) {
      console.error(`[agent-signup] referral lookup failed: ${err.message}`);
    }
  }
  return normaliseReferralCode(refParam) || '';
}

export default async function AgentSignupPage({ searchParams }) {
  const t = await getT();
  const locale = await getLocale();
  const country = await getRequestCountry();
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const next = typeof params.next === 'string' ? params.next : '/compte/agent';
  // With verification bypassed there is no code, so neither the subtitle nor
  // the button may promise one — see lib/otpBypass.js and this app's
  // "Honest UI State" rule. The copy is chosen here, in a Server Component,
  // because the flag is server-only.
  const bypassing = otpBypassEnabled();
  const referralCode = await referralPrefill(typeof params.ref === 'string' ? params.ref : null);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 u-lift sm:p-8">
        <h1 className="u-title-section text-ink">{t('auth.agentSignupTitle')}</h1>
        <p className="mt-1 text-sm text-ink-45">
          {bypassing ? t('auth.signup.noCodeNeeded') : t('auth.signup.codeWillBeSent')}
        </p>

        <form action={agentSignupAction} className="mt-6 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />

          {/* Two fields, not one "Nom complet": the agency or trade name is the
              public heading (agents.agency_name — the column the WhatsApp
              onboarding already fills), the person is who customers speak to
              (agent_infos first/last name). */}
          <div>
            <label htmlFor="agency_name" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              {t('auth.signup.agencyName')}
            </label>
            <input
              id="agency_name"
              type="text"
              name="agency_name"
              autoComplete="organization"
              placeholder="Ex. Espace Kin Immobilier"
              autoFocus
              required
              maxLength={160}
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
            />
          </div>

          <div>
            <label htmlFor="contact_name" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              {t('auth.signup.contactName')}
            </label>
            <input
              id="contact_name"
              type="text"
              name="contact_name"
              autoComplete="name"
              placeholder="Ex. Jean Dupont"
              required
              maxLength={160}
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
            />
          </div>

          <PhoneField
            name="phone"
            id="phone"
            defaultCountry={country}
            locale={locale}
            labels={{ ...phoneFieldLabels(t), label: t('agent.settings.whatsappNumber') }}
            required
          />

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

          <div>
            <label htmlFor="referral_code" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              {t('auth.referralCode')}
            </label>
            <input
              id="referral_code"
              type="text"
              name="referral_code"
              defaultValue={referralCode}
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={20}
              placeholder="JEAN01"
              aria-describedby="referral_code_hint"
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm uppercase text-ink"
            />
            <p id="referral_code_hint" className="mt-1 text-xs text-ink-45">{t('auth.referralCodeHint')}</p>
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {(ERROR_MESSAGE_KEYS[error] ? t(ERROR_MESSAGE_KEYS[error]) : null) || t(ERROR_MESSAGE_KEYS.phone)}
            </p>
          )}

          <button
            type="submit"
            className="mt-1 rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
          >
            {bypassing ? t('auth.createMyAccount') : t('auth.signup.receiveCode')}
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
