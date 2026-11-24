import Link from 'next/link';
import { redirect } from 'next/navigation';
import WhatsAppVerifyPanel from '@/components/WhatsAppVerifyPanel';
import SignInCodeForm, { CodeFallback, ResendCodeButton } from '@/components/SignInCodeForm';
import { getT } from '@/lib/i18n/server';
import { getVerifyAttempt, maskPhone } from '@/lib/verifyAttempt';
import { ensureChallenge, whatsappVerifyHref, whatsappVerifyNumber } from '@/lib/whatsappVerify';
import { safeSignInNext } from '@/lib/whatsappSignInRules';
import { getCustomerAuthById } from '@/lib/customers';
import { signInCodeEnabled } from '@/lib/signInCode';
import { checkWhatsAppSignInAction, sendSignInCodeAction } from '../whatsappActions';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('auth.whatsappSignIn.title'), robots: { index: false, follow: false } };
}

// Keys, not text (a module constant cannot hold translated copy).
const CODE_ERROR_KEYS = {
  invalid: 'auth.errors.codeInvalid',
  expired: 'auth.errors.codeExpired',
  too_many: 'auth.whatsappSignIn.errors.tooMany',
  no_code: 'auth.whatsappSignIn.errors.noCode',
  expired_attempt: 'auth.whatsappSignIn.errors.restart',
};
const SEND_ERROR_KEYS = {
  send_failed: 'auth.errors.sendFailed',
  send_busy: 'auth.whatsappSignIn.errors.sendBusy',
};

/**
 * Signing in to an account that already exists (a new number never comes
 * here: it is signed in at once, lib/newCustomerSession.js). Reachable only
 * with the signed attempt cookie.
 *
 * With the code template on (lib/signInCode.js, 2026-11-24): we send a
 * 6-digit code to that WhatsApp and they type it here — "Recevoir mon code"
 * first when none is waiting (arriving from a request or visit confirmation),
 * the code box once one is. "Code pas reçu ?" underneath opens the older way:
 * they send us a code from their WhatsApp and the panel signs them in once the
 * engine has matched it on their number. Without the template, that older way
 * is the screen.
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
  const restartHref = `/compte/connexion?next=${encodeURIComponent(next)}`;
  const reversePanel = challenge ? (
    <WhatsAppVerifyPanel
      code={challenge.code}
      href={whatsappVerifyHref(challenge.code)}
      maskedPhone={maskPhone(attempt.phone)}
      businessNumber={whatsappVerifyNumber()}
      next={next}
      restartHref={restartHref}
      checkAction={checkWhatsAppSignInAction}
    />
  ) : (
    <p className="mt-4 text-sm text-red-600" role="alert">{t('auth.whatsappVerify.noNumber')}</p>
  );

  const codeMode = signInCodeEnabled();
  let codeWaiting = false;
  if (codeMode) {
    const customer = await getCustomerAuthById(attempt.id);
    codeWaiting = Boolean(customer?.otp_code_hash && customer.otp_expires_at && new Date(customer.otp_expires_at) > new Date());
  }
  const sent = params.sent === '1';
  const sendError = typeof params.error === 'string' && SEND_ERROR_KEYS[params.error] ? params.error : null;
  const masked = maskPhone(attempt.phone);

  const codeErrors = Object.fromEntries(Object.entries(CODE_ERROR_KEYS).map(([k, key]) => [k, t(key)]));
  const resendLabels = {
    now: t('auth.resend.now'),
    sending: t('auth.resend.sending'),
    retryIn: t('auth.resend.retryIn', { seconds: '{seconds}' }),
  };

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 u-lift sm:p-8">
        <h1 className="u-title-section text-ink">
          {codeMode ? t('auth.whatsappSignIn.signInTitle') : t('auth.whatsappSignIn.codeTitle')}
        </h1>
        {/* From sign-up, a request or a visit on a number that already has
            an account: this signs them in, no password. */}
        {params.compte === 'existant' ? (
          <p className="mt-2 rounded-md bg-blue-tint px-3 py-2 text-[0.8125rem] font-semibold text-blue-deep">
            {t(codeMode ? 'auth.whatsappSignIn.existingAccountCode' : 'auth.whatsappSignIn.existingAccount')}
          </p>
        ) : null}

        {!codeMode ? reversePanel : (
          <>
            {sendError ? (
              <p className="mt-4 text-sm text-red-600" role="alert">{t(SEND_ERROR_KEYS[sendError])}</p>
            ) : null}
            {codeWaiting ? (
              <>
                <p className="mt-4 text-sm text-ink-70">
                  {t('auth.codeSentTo', { phone: masked })}
                  {sent ? ` ${t('auth.newCodeSent')}` : ''}
                </p>
                <SignInCodeForm
                  next={next}
                  labels={{ code: t('auth.verificationCode'), signIn: t('auth.whatsappSignIn.signIn'), errors: codeErrors }}
                />
                <form action={sendSignInCodeAction} className="mt-3 text-center">
                  <input type="hidden" name="next" value={next} />
                  <ResendCodeButton key={sent ? 'sent' : 'initial'} labels={resendLabels} startCooling={sent} />
                </form>
              </>
            ) : (
              <form action={sendSignInCodeAction} className="mt-4 flex flex-col gap-3">
                <input type="hidden" name="next" value={next} />
                <p className="text-sm text-ink-70">{t('auth.whatsappSignIn.codeLead', { phone: masked })}</p>
                <button
                  type="submit"
                  className="u-press flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#1E7B54] px-4 text-[0.9375rem] font-semibold text-white"
                >
                  {t('auth.whatsappSignIn.sendCode')}
                </button>
              </form>
            )}
            <CodeFallback label={t('auth.whatsappSignIn.noCodeFallback')}>{reversePanel}</CodeFallback>
          </>
        )}

        <p className="mt-5 text-center text-sm text-ink-70">
          {t('auth.whatsappSignIn.otherNumber')}{' '}
          <Link href={restartHref} className="font-semibold text-blue-deep hover:underline">
            {t('auth.whatsappSignIn.restart')}
          </Link>
        </p>
      </div>
    </div>
  );
}
