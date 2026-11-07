import Link from 'next/link';
import { Check } from 'lucide-react';
import { signupAction } from './actions';
import SignupForm from './SignupForm';
import { getRequestCountry } from '@/lib/requestCountry';
import { getT } from '@/lib/i18n/server';
import { partnerCodePrefill } from '@/lib/partnerPrefill';
import { whatsappSignupLink } from '@/lib/whatsappSignup';
import { WhatsAppIcon } from '@/components/WhatsAppCTA';
import MoveOnboarding from '@/components/MoveOnboarding';

// generateMetadata, not a static object: a static export cannot see the
// request locale — see app/(site)/a-propos/page.js.
export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('auth.customerSignupMetaTitle'),
    robots: { index: false, follow: false },
  };
}

export default async function CustomerSignupPage({ searchParams }) {
  const t = await getT();
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const next = typeof params.next === 'string' ? params.next : '/compte/client';
  // Prefilled by AuthPromptModal.js's Save Search / Create Alert gate —
  // real hand-off of what the visitor already typed, not a default guess.
  const initialPhone = typeof params.phone === 'string' ? params.phone : '';
  // The country the AuthPromptModal handed over wins; otherwise the field
  // opens on the visitor's own country, decided server-side so the first
  // paint already shows the right dial code (lib/requestCountry.js).
  const initialCountry = typeof params.country === 'string' ? params.country : await getRequestCountry();
  const partnerCode = await partnerCodePrefill(typeof params.code === 'string' ? params.code : null);
  const whatsappHref = whatsappSignupLink(partnerCode || null);

  // "Mon déménagement" (2026-11-07): the questions first, card by card, and
  // the account form as the last card (components/MoveOnboarding.js). The
  // plain form stays at ?direct=1 for links that want it. An error redirect
  // reopens on the account card with the answers restored from the draft.
  if (params.direct !== '1') {
    return (
      <MoveOnboarding
        mode="signup"
        startAtEnd={Boolean(error)}
        signupProps={{
          action: signupAction,
          next,
          error,
          initialPhone,
          initialCountry,
          partnerCode,
          phoneHintKey: 'auth.signup.phoneHint',
        }}
        accountFooter={
          <>
            {whatsappHref ? (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="u-press mt-4 flex h-11 items-center justify-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-bold text-ink hover:border-green"
              >
                <WhatsAppIcon className="h-[1.125rem] w-[1.125rem] text-green" />
                {t('auth.whatsappSignup.cta')}
              </a>
            ) : null}
            <p className="mt-5 text-center text-sm text-ink-45">
              Déjà un compte ?{' '}
              <Link href={`/compte/connexion?next=${encodeURIComponent(next)}`} className="font-semibold text-blue-deep hover:underline">
                {t('admin.login.submit')}
              </Link>
            </p>
          </>
        }
      />
    );
  }

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 u-lift sm:p-8">
        <h1 className="u-title-section text-ink">{t('common.actions.signup')}</h1>
        {/* What the account is for — three things it already does: the daily
            search-alerts sweep, account favourites, and the price-drop
            WhatsApp on saved listings (lib/favoritePriceDrops.js). */}
        <ul className="mt-3 flex flex-col gap-2">
          {['alerts', 'favorites', 'priceDrops'].map((key) => (
            <li key={key} className="flex items-start gap-2 text-[0.875rem] leading-snug text-ink">
              <Check strokeWidth={2.5} aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-green-deep" />
              {t(`auth.signupBenefits.${key}`)}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-ink-45">
          {t('auth.signupKeepsLocal')}
        </p>

        {whatsappHref ? (
          <>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="u-press mt-5 flex h-11 items-center justify-center gap-2 rounded-md bg-green px-4 text-sm font-bold text-white hover:bg-green-deep"
            >
              <WhatsAppIcon className="h-[1.125rem] w-[1.125rem]" />
              {t('auth.whatsappSignup.cta')}
            </a>
            <p className="mt-1.5 text-center text-xs text-ink-45">{t('auth.whatsappSignup.hint')}</p>
            <p className="u-micro mt-4 text-center text-ink-45">{t('auth.whatsappSignup.or')}</p>
          </>
        ) : null}

        <SignupForm
          action={signupAction}
          next={next}
          error={error}
          initialPhone={initialPhone}
          initialCountry={initialCountry}
          partnerCode={partnerCode}
          phoneHintKey="auth.signup.phoneHint"
        />

        <p className="mt-5 text-center text-sm text-ink-45">
          Déjà un compte ?{' '}
          <Link href={`/compte/connexion?next=${encodeURIComponent(next)}`} className="font-semibold text-blue-deep hover:underline">
            {t('admin.login.submit')}
          </Link>
        </p>
      </div>
    </div>
  );
}
