import Link from 'next/link';
import { redirect } from 'next/navigation';
import WhatsAppVerifyPanel from '@/components/WhatsAppVerifyPanel';
import { getT } from '@/lib/i18n/server';
import { getVerifyAttempt, maskPhone } from '@/lib/verifyAttempt';
import { ensureChallenge, whatsappVerifyHref, whatsappVerifyNumber } from '@/lib/whatsappVerify';
import { safeSignInNext } from '@/lib/whatsappSignInRules';
import { checkWhatsAppSignInAction } from '../whatsappActions';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('auth.whatsappSignIn.title'), robots: { index: false, follow: false } };
}

/**
 * The code screen of "Continuer avec WhatsApp". Reachable only with the
 * signed attempt cookie the start action set; the code is sent from the
 * person's WhatsApp and the panel signs them in once the engine has matched
 * it on their number.
 */
export default async function WhatsAppSignInPage({ searchParams }) {
  const t = await getT();
  const params = await searchParams;
  const next = safeSignInNext(params.next);
  const attempt = await getVerifyAttempt();
  if (!attempt || attempt.role !== 'customer') {
    redirect(`/compte/connexion?next=${encodeURIComponent(next)}`);
  }

  let challenge = null;
  try {
    challenge = await ensureChallenge(attempt);
  } catch (err) {
    console.error(`[wa-signin] could not open a challenge for customer #${attempt.id}: ${err.message}`);
  }

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 u-lift sm:p-8">
        <h1 className="u-title-section text-ink">{t('auth.whatsappSignIn.codeTitle')}</h1>
        {params.nouveau === '1' ? (
          <p className="mt-2 rounded-md bg-green-tint px-3 py-2 text-[0.8125rem] font-semibold text-green-deep">
            {t('auth.whatsappSignIn.newAccount')}
          </p>
        ) : null}
        {challenge ? (
          <WhatsAppVerifyPanel
            code={challenge.code}
            href={whatsappVerifyHref(challenge.code)}
            maskedPhone={maskPhone(attempt.phone)}
            businessNumber={whatsappVerifyNumber()}
            next={next}
            restartHref={`/compte/connexion?next=${encodeURIComponent(next)}`}
            checkAction={checkWhatsAppSignInAction}
          />
        ) : (
          <p className="mt-4 text-sm text-red-600" role="alert">{t('auth.whatsappVerify.noNumber')}</p>
        )}
        <p className="mt-5 text-center text-sm text-ink-70">
          {t('auth.whatsappSignIn.otherNumber')}{' '}
          <Link href={`/compte/connexion?next=${encodeURIComponent(next)}`} className="font-semibold text-blue-deep hover:underline">
            {t('auth.whatsappSignIn.restart')}
          </Link>
        </p>
      </div>
    </div>
  );
}
