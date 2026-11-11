'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { getFavoriteIds, getSavedSearches } from '@/lib/localFavorites';
import PhoneField from '@/components/PhoneField';
import PasswordInput from '@/components/PasswordInput';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { useLocale, useT } from '@/lib/i18n/client';
import { trackCustomerSignup } from '@/lib/analyticsClient';

// Keys, not text: a module-level constant is evaluated once at import,
// where `t` does not exist — see components/navItems.js.
const ERROR_MESSAGE_KEYS = {
  name: 'auth.errors.fullNameRequired',
  phone: 'auth.errors.phoneInvalid',
  password: 'auth.errors.passwordMin8',
  exists: 'auth.errors.accountExists',
  expired_attempt: 'auth.errors.expiredAttempt',
  ref: 'auth.errors.partnerCodeUnknown',
};

/**
 * Locked while the account is being created: on a slow connection a second
 * tap would send the same number again (2026-11-07, before the campaign).
 */
function CreateAccountButton({ label, pendingLabel }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="mt-1 rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep disabled:opacity-60 u-btn-primary"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * "Ce numéro a déjà un compte" with the way out: sign in with that number.
 * A submit button with its own formAction, so it carries the typed number
 * (and the move answers flag) without the name or password being required.
 */
function ExistingAccountNotice({ signInAction, hasAnswers }) {
  const t = useT();
  return (
    <div role="alert" className="rounded-md border border-blue/30 bg-blue-tint px-3 py-2.5 text-[0.8125rem] text-ink">
      <p className="font-semibold">{t('auth.errors.accountExists')}</p>
      {hasAnswers ? <p className="mt-0.5 text-ink-70">{t('auth.signup.existsKeepsAnswers')}</p> : null}
      {signInAction ? (
        <button
          type="submit"
          formAction={signInAction}
          formNoValidate
          name="withProject"
          value={hasAnswers ? '1' : '0'}
          className="u-press mt-2 inline-flex min-h-10 items-center rounded-full bg-blue px-4 text-[0.8125rem] font-bold text-white"
        >
          {t('auth.signup.signInWithNumber')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The account form (the last sign-up card, and /compte/inscription?direct=1).
 * Reads the visitor's anonymous favourites/saved searches into hidden fields
 * right before submit, so signupAction can merge them into the new account.
 *
 * 2026-11-08 (owner request, sign-up friction review):
 * - a refusal comes back as state, not a redirect: the name, number and code
 *   stay typed (the number field re-opens with them), and the password stays
 *   in this component's own state;
 * - the cursor starts on the name, the first field (it used to skip to the
 *   number, so the name was the field most often missed);
 * - the number is checked as soon as it is typed: an existing account is
 *   said there, with "Se connecter avec ce numéro";
 * - the password has a show/hide eye.
 */
export default function SignupForm({
  action,
  next,
  error: initialError,
  initialPhone = '',
  initialCountry = '',
  partnerCode = '',
  // The phone hint is a KEY passed down rather than resolved here, because
  // whether a code is actually sent depends on a server-only flag
  // (lib/otpBypass.js) that a client component cannot read.
  phoneHintKey = 'auth.signup.phoneHint',
  checkPhoneAction = null,
  signInAction = null,
  // Whether the move cards before this one were answered (they ride along
  // as `children`, MoveOnboarding's hidden `moveProject` field).
  hasAnswers = false,
  // Where this sign-up started (lib/signupFunnelRules.js), sent with the form.
  entry = 'direct',
  children = null,
}) {
  const t = useT();
  const locale = useLocale();
  const formRef = useRef(null);
  const [state, formAction] = useActionState(action, null);
  const values = state?.values || null;
  const error = state ? state.error : initialError;
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [knownAccount, setKnownAccount] = useState(false);
  const [, startCheck] = useTransition();
  const lastChecked = useRef('');
  const started = useRef(false);

  // The funnel's form_start: the first character typed, once per mount
  // (not focus: the name field is autoFocused, so focus says nothing).
  function handleFirstInput() {
    if (started.current) return;
    started.current = true;
    trackCustomerSignup('form_start', entry);
  }

  function handleSubmit() {
    trackCustomerSignup('submit', entry);
    const form = formRef.current;
    if (!form) return;
    form.favoriteIds.value = getFavoriteIds().join(',');
    form.savedSearches.value = JSON.stringify(getSavedSearches());
  }

  // Checked when the number field loses focus (the blur bubbles up from the
  // input inside PhoneField). Only a complete-looking number is asked about.
  function checkNumber() {
    if (!checkPhoneAction || !formRef.current) return;
    const data = new FormData(formRef.current);
    const phone = String(data.get('phone') || '').trim();
    const country = String(data.get('phoneCountry') || '');
    const key = `${country}|${phone}`;
    if (phone.replace(/\D/g, '').length < 6 || key === lastChecked.current) return;
    lastChecked.current = key;
    startCheck(async () => {
      try {
        const result = await checkPhoneAction(phone, country);
        setKnownAccount(Boolean(result?.exists));
      } catch {
        setKnownAccount(false);
      }
    });
  }

  // A number handed over by the save pop-up is checked at once.
  useEffect(() => {
    if (initialPhone) checkNumber();
    // Once, on mount: checkNumber reads the form itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The server's "exists" refusal shows the same notice; editing the number
  // clears it (and lets the new number be checked).
  useEffect(() => {
    if (state) setKnownAccount(state.error === 'exists');
  }, [state]);

  function numberEdited() {
    if (knownAccount) setKnownAccount(false);
    lastChecked.current = '';
  }

  const showExists = knownAccount || (!state && initialError === 'exists');

  return (
    <form ref={formRef} action={formAction} onSubmit={handleSubmit} onInput={handleFirstInput} className="mt-6 flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="entry" value={entry} />
      <input type="hidden" name="favoriteIds" />
      <input type="hidden" name="savedSearches" />
      {children}

      <div>
        <label htmlFor="fullName" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
          {t('auth.signup.fullName')}
        </label>
        <input
          id="fullName"
          type="text"
          name="fullName"
          autoComplete="name"
          required
          minLength={2}
          maxLength={120}
          autoFocus
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
        />
      </div>

      <div onBlur={checkNumber} onInput={numberEdited}>
        <PhoneField
          key={state?.attempt || 'first'}
          name="phone"
          id="phone"
          defaultValue={values ? values.phone : initialPhone}
          defaultCountry={(values && values.phoneCountry) || initialCountry || undefined}
          locale={locale}
          labels={phoneFieldLabels(t)}
          hint={t(phoneHintKey)}
          required
        />
      </div>
      {showExists ? <ExistingAccountNotice signInAction={signInAction} hasAnswers={hasAnswers} /> : null}

      <div>
        <label htmlFor="password" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
          {t('auth.password')}
        </label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="mt-1 text-xs text-ink-45">{t('auth.minEightChars')}</p>
      </div>

      <div>
        <label htmlFor="partner_code" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
          {t('auth.partnerCode')}
        </label>
        <input
          key={state?.attempt || 'first'}
          id="partner_code"
          type="text"
          name="partner_code"
          defaultValue={values ? values.partnerCode : partnerCode}
          maxLength={20}
          autoCapitalize="characters"
          autoComplete="off"
          aria-describedby="partner_code_hint"
          className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm uppercase text-ink"
        />
        <p id="partner_code_hint" className="mt-1 text-xs text-ink-45">{t('auth.partnerCodeHint')}</p>
      </div>

      {error && error !== 'exists' && (
        <p className="text-sm text-red-600" role="alert">
          {(ERROR_MESSAGE_KEYS[error] ? t(ERROR_MESSAGE_KEYS[error]) : null) || t('common.shared.somethingWentWrong')}
        </p>
      )}

      <CreateAccountButton label={t('auth.createMyAccount')} pendingLabel={t('auth.creatingAccount')} />
    </form>
  );
}
