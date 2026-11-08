import Link from 'next/link';
import { cookies } from 'next/headers';
import { Check } from 'lucide-react';
import { agentSignupAction } from './actions';
import { normaliseReferralCode } from '@/lib/launchCommission';
import { findRepByReferralCode } from '@/lib/salesLaunch';
import { REFERRAL_COOKIE, parseReferralCookie } from '@/lib/salesReferral';
import { partnerCodePrefill } from '@/lib/partnerPrefill';
import { agentWhatsappSignupLink } from '@/lib/whatsappSignup';
import AgentSignupForm from './AgentSignupForm';
import SignupFunnelTracker from '@/components/SignupFunnelTracker';
import { WhatsAppIcon } from '@/components/WhatsAppCTA';
import { getRequestCountry } from '@/lib/requestCountry';
import { getT } from '@/lib/i18n/server';
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

        <AgentSignupForm
          action={agentSignupAction}
          next={next}
          error={error}
          country={country}
          referralCode={referralCode}
          referralOpen={referralOpen}
          bypassing={bypassing}
          signInLabel={t('admin.login.submit')}
          phoneLabel={t('agent.settings.whatsappNumber')}
        />

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
