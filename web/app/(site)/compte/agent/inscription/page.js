import Link from 'next/link';
import { cookies } from 'next/headers';
import { Check } from 'lucide-react';
import { agentSignupAction } from './actions';
import { normaliseReferralCode } from '@/lib/launchCommission';
import { findRepByReferralCode } from '@/lib/salesLaunch';
import { REFERRAL_COOKIE, parseReferralCookie } from '@/lib/salesReferral';
import { partnerCodePrefill } from '@/lib/partnerPrefill';
import { agentWhatsappSignupLink } from '@/lib/whatsappSignup';
import PhoneField from '@/components/PhoneField';
import SignupFunnelTracker from '@/components/SignupFunnelTracker';
import { WhatsAppIcon } from '@/components/WhatsAppCTA';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { getRequestCountry } from '@/lib/requestCountry';
import { getLocale, getT } from '@/lib/i18n/server';
import { otpBypassEnabled } from '@/lib/otpBypass';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

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
  // Kept for a link to ?error=agency from before the agency became optional.
  agency: 'auth.errors.agencyNameRequired',
  phone: 'auth.errors.phoneInvalid',
  password: 'auth.errors.passwordMin8',
  exists: 'auth.errors.accountExists',
  otp_failed: 'auth.errors.otpFailed',
  ref: 'auth.errors.referralUnknown',
};

/** 16px on a phone (a smaller input makes iOS zoom on focus), 44px tall. */
const INPUT_CLASS = 'u-focus-ring h-11 w-full rounded-md border border-line bg-white px-3 text-base text-ink sm:text-sm';
const LABEL_CLASS = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45';

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
  // Else the partner whose link brought this browser (lp_ref): the same field
  // takes either kind of code.
  const partner = await partnerCodePrefill(null);
  if (partner) return partner;
  return normaliseReferralCode(refParam) || '';
}

/**
 * The code the WhatsApp message may carry: an ACTIVE sales rep's only. The
 * engine's referral handler knows reps, not partners, and would answer a
 * partner's code with "code inconnu" (lib/whatsappSignup.js).
 */
async function repCodeForWhatsapp(code) {
  if (!code) return null;
  try {
    const rep = await findRepByReferralCode(code);
    return rep?.status === 'active' ? code : null;
  } catch (err) {
    console.error(`[agent-signup] rep lookup for the WhatsApp link failed: ${err.message}`);
    return null;
  }
}

/**
 * Agent signup. Reworked 2026-11-04 after the 29–30 October campaign sent
 * 4,215 phone visitors here and 2 reached the code step: the page opened on a
 * five-field form that began with "Nom de l'agence" and said nothing about why
 * to join. Now: what an agent gets (claims already made elsewhere — the
 * engine's SIGNUP_REPLY states the 2 free months — and a real count), the
 * WhatsApp route first (an account is created by sending a first listing,
 * services/agentOnboarding.js), then a form that asks for the person and
 * leaves the agency optional. SignupFunnelTracker logs how far visitors get.
 */
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
  const whatsappRepCode = await repCodeForWhatsapp(referralCode);
  const whatsappHref = agentWhatsappSignupLink(whatsappRepCode);
  // A code already carried (link, cookie, ?ref=) stays in sight; otherwise the
  // field folds away behind "J'ai un code de parrainage", and an error about
  // the code reopens it.
  const referralOpen = Boolean(referralCode) || error === 'ref';

  // The live-listing count ("279 biens déjà en ligne") was removed on the
  // owner's request, 2026-11-04.
  const pitch = [t('auth.agentSignup.pitchFree'), t('auth.agentSignup.pitchLeads')];

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 py-6">
      <div id="agent-signup" className="w-full max-w-sm rounded-card border border-line bg-surface p-5 u-lift sm:p-8">
        <h1 className="u-title-section text-ink">{t('auth.agentSignupTitle')}</h1>

        <ul className="mt-3 flex flex-col gap-2">
          {pitch.map((line) => (
            <li key={line} className="flex items-start gap-2 text-sm text-ink-70">
              <Check aria-hidden="true" size={16} strokeWidth={ICON_STROKE_WIDTH + 0.75} className="mt-0.5 flex-none text-green-ink" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {whatsappHref ? (
          <>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              data-signup-step="whatsapp_tap"
              className="u-press mt-5 flex h-11 items-center justify-center gap-2 rounded-md bg-green px-4 text-sm font-bold text-white hover:bg-green-deep"
            >
              <WhatsAppIcon className="h-[1.125rem] w-[1.125rem]" />
              {t('auth.agentSignup.whatsappCta')}
            </a>
            <p className="mt-1.5 text-center text-xs text-ink-45">{t('auth.agentSignup.whatsappHint')}</p>
            <p className="u-micro mt-4 text-center text-ink-45">{t('auth.agentSignup.or')}</p>
          </>
        ) : null}

        <form id="agent-signup-form" action={agentSignupAction} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />

          {/* The person first, the agency optional: agent_infos first/last
              name is who customers speak to; agents.agency_name, when there is
              one, is the public heading (AGENCY_NAME_EXPR falls back to the
              person). Nothing takes focus on load: focusing the first field
              opened a phone's keyboard over the reasons to sign up. */}
          <div>
            <label htmlFor="contact_name" className={LABEL_CLASS}>
              {t('auth.agentSignup.yourName')}
            </label>
            <input
              id="contact_name"
              type="text"
              name="contact_name"
              autoComplete="name"
              placeholder="Ex. Jean Dupont"
              required
              maxLength={160}
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="agency_name" className={LABEL_CLASS}>
              {t('auth.agentSignup.agencyOptional')}
            </label>
            <input
              id="agency_name"
              type="text"
              name="agency_name"
              autoComplete="organization"
              placeholder="Ex. Espace Kin Immobilier"
              maxLength={160}
              aria-describedby="agency_name_hint"
              className={INPUT_CLASS}
            />
            <p id="agency_name_hint" className="mt-1 text-xs text-ink-45">{t('auth.agentSignup.agencyHint')}</p>
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
            <label htmlFor="password" className={LABEL_CLASS}>
              {t('auth.password')}
            </label>
            <input
              id="password"
              type="password"
              name="password"
              autoComplete="new-password"
              minLength={8}
              required
              className={INPUT_CLASS}
            />
          </div>

          <details open={referralOpen} className="group">
            <summary
              data-signup-step="referral_open"
              className="flex min-h-11 cursor-pointer list-none items-center text-sm font-semibold text-blue-deep [&::-webkit-details-marker]:hidden"
            >
              {t('auth.agentSignup.haveCode')}
            </summary>
            <div>
              <label htmlFor="referral_code" className={LABEL_CLASS}>
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
                className={`${INPUT_CLASS} uppercase`}
              />
              <p id="referral_code_hint" className="mt-1 text-xs text-ink-45">{t('auth.referralCodeHint')}</p>
            </div>
          </details>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {(ERROR_MESSAGE_KEYS[error] ? t(ERROR_MESSAGE_KEYS[error]) : null) || t(ERROR_MESSAGE_KEYS.phone)}
            </p>
          )}

          <p className="text-xs text-ink-45">
            {bypassing ? t('auth.signup.noCodeNeeded') : t('auth.signup.codeWillBeSent')}
          </p>

          <button
            type="submit"
            className="h-11 rounded-md bg-blue px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
          >
            {bypassing ? t('auth.createMyAccount') : t('auth.signup.receiveCode')}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-45">
          {t('auth.agentSignup.alreadyAccount')}{' '}
          <Link
            href={`/compte/agent/connexion?next=${encodeURIComponent(next)}`}
            className="font-semibold text-blue-deep hover:underline"
          >
            {t('admin.login.submit')}
          </Link>
        </p>
      </div>
      <SignupFunnelTracker formId="agent-signup-form" scopeId="agent-signup" form="agent" />
    </div>
  );
}
