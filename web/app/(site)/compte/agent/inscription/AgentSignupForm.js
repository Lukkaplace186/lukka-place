'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import PhoneField from '@/components/PhoneField';
import PasswordInput from '@/components/PasswordInput';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { useLocale, useT } from '@/lib/i18n/client';

// Keys, not text — see components/navItems.js.
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

function SubmitButton({ label, pendingLabel }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 rounded-md bg-blue px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-deep disabled:opacity-60 u-btn-primary"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * The agent sign-up form (2026-11-08, owner request, agent friction review):
 * a refusal comes back as state, so the name, agency, number, password and
 * code stay typed (the number field re-opens with them); the password has a
 * show/hide eye; "Un compte existe déjà" says what to do — sign in, or set a
 * password by WhatsApp code. Nothing takes focus on load: focusing the first
 * field opened a phone's keyboard over the reasons to sign up.
 */
// signInLabel / phoneLabel: resolved by the page — this tree ships neither the
// admin nor the agent namespace.
export default function AgentSignupForm({ action, next, error: initialError, country, referralCode = '', referralOpen = false, bypassing = false, signInLabel, phoneLabel }) {
  const t = useT();
  const locale = useLocale();
  const [state, formAction] = useActionState(action, null);
  const error = state ? state.error : initialError;
  const values = state?.values || null;
  const [contactName, setContactName] = useState('');
  const [agencyName, setAgencyName] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form id="agent-signup-form" action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />

      {/* The person first, the agency optional: agent_infos first/last name is
          who customers speak to; agents.agency_name, when there is one, is
          the public heading (AGENCY_NAME_EXPR falls back to the person). */}
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
          value={contactName}
          onChange={(event) => setContactName(event.target.value)}
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
          value={agencyName}
          onChange={(event) => setAgencyName(event.target.value)}
          className={INPUT_CLASS}
        />
        <p id="agency_name_hint" className="mt-1 text-xs text-ink-45">{t('auth.agentSignup.agencyHint')}</p>
      </div>

      <PhoneField
        key={state?.attempt || 'first'}
        name="phone"
        id="phone"
        defaultValue={values ? values.phone : ''}
        defaultCountry={(values && values.phoneCountry) || country}
        locale={locale}
        labels={{ ...phoneFieldLabels(t), label: phoneLabel }}
        required
      />

      <div>
        <label htmlFor="password" className={LABEL_CLASS}>
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
          inputClassName="h-11 text-base sm:text-sm"
        />
        <p className="mt-1 text-xs text-ink-45">{t('auth.minEightChars')}</p>
      </div>

      <details open={referralOpen || error === 'ref'} className="group">
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
            key={state?.attempt || 'first'}
            id="referral_code"
            type="text"
            name="referral_code"
            defaultValue={values ? values.referralCode : referralCode}
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

      {error === 'exists' ? (
        <div role="alert" className="rounded-md border border-blue/30 bg-blue-tint px-3 py-2.5 text-[0.8125rem] text-ink">
          <p className="font-semibold">{t('auth.errors.accountExists')}</p>
          <p className="mt-0.5 text-ink-70">{t('auth.agentSignup.existsHelp')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link
              href={`/compte/agent/connexion?next=${encodeURIComponent(next)}`}
              className="u-press inline-flex min-h-10 items-center rounded-full bg-blue px-4 text-[0.8125rem] font-bold text-white"
            >
              {signInLabel}
            </Link>
            <Link
              href="/mot-de-passe-oublie?role=agent"
              className="u-press inline-flex min-h-10 items-center rounded-full bg-surface px-4 text-[0.8125rem] font-bold text-blue-deep shadow-[var(--hairline)]"
            >
              {t('account.profile.forgotPassword')}
            </Link>
          </div>
        </div>
      ) : error ? (
        <p className="text-sm text-red-600" role="alert">
          {(ERROR_MESSAGE_KEYS[error] ? t(ERROR_MESSAGE_KEYS[error]) : null) || t(ERROR_MESSAGE_KEYS.phone)}
        </p>
      ) : null}

      <p className="text-xs text-ink-45">
        {bypassing ? t('auth.signup.noCodeNeeded') : t('auth.signup.codeWillBeSent')}
      </p>

      <SubmitButton
        label={bypassing ? t('auth.createMyAccount') : t('auth.signup.receiveCode')}
        pendingLabel={t('auth.creatingAccount')}
      />
    </form>
  );
}
