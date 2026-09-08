import Link from 'next/link';
import { signupAction } from './actions';
import SignupForm from './SignupForm';
import { getRequestCountry } from '@/lib/requestCountry';
import { getT } from '@/lib/i18n/server';
import { otpBypassEnabled } from '@/lib/otpBypass';

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

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 u-lift sm:p-8">
        <h1 className="u-title-section text-ink">{t('common.actions.signup')}</h1>
        <p className="mt-1 text-sm text-ink-45">
          {t('auth.signupKeepsLocal')}
        </p>

        <SignupForm
          action={signupAction}
          next={next}
          error={error}
          initialPhone={initialPhone}
          initialCountry={initialCountry}
          phoneHintKey={otpBypassEnabled() ? 'auth.signup.noCodeNeeded' : 'auth.signup.codeWillBeSent'}
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
