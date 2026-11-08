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
  1: 'auth.errors.badCredentials',
  phone: 'auth.errors.phoneInvalid',
  locked: 'auth.errors.locked',
  otp_failed: 'auth.errors.otpFailed',
};

const FORGOT_HREF = '/mot-de-passe-oublie?role=agent';

function SignInButton({ label, pendingLabel }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep disabled:opacity-60 u-btn-primary"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * Agent sign-in (2026-11-08, owner request, agent friction review): the
 * number this device last signed in with is already there; a refusal keeps
 * the number and the password; the password has a show/hide eye; "too many
 * tries" links the WhatsApp reset, which unlocks at once. An agent who joined
 * on WhatsApp and has no password is sent by the action to choose one.
 */
// submitLabel: resolved by the page — this tree does not ship the admin namespace.
export default function AgentLoginForm({ action, next, error: initialError, defaultCountry, defaultPhone = '', submitLabel }) {
  const t = useT();
  const locale = useLocale();
  const [state, formAction] = useActionState(action, null);
  const [password, setPassword] = useState('');
  const error = state ? state.error : initialError;
  const values = state?.values || null;
  const phoneValue = values ? values.phone : defaultPhone;

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />

      <PhoneField
        key={state?.attempt || 'first'}
        name="phone"
        id="phone"
        defaultCountry={(values && values.phoneCountry) || defaultCountry}
        defaultValue={phoneValue}
        detectCountry={!phoneValue}
        locale={locale}
        labels={phoneFieldLabels(t)}
        autoFocus={!phoneValue}
        required
      />

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-wide text-ink-45">
            {t('auth.password')}
          </label>
          <Link href={FORGOT_HREF} className="text-xs font-semibold text-blue-deep hover:underline">
            {t('account.profile.forgotPassword')}
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          autoFocus={Boolean(phoneValue)}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="mt-1 text-xs text-ink-45">{t('auth.agentNoPasswordHint')}</p>
      </div>

      {error && (
        <div className="text-sm text-red-600" role="alert">
          <p>{(ERROR_MESSAGE_KEYS[error] ? t(ERROR_MESSAGE_KEYS[error]) : null) || t(ERROR_MESSAGE_KEYS[1])}</p>
          {error === 'locked' ? (
            <Link href={FORGOT_HREF} className="mt-1.5 inline-flex min-h-10 items-center font-semibold text-blue-deep underline">
              {t('auth.errors.lockedReset')}
            </Link>
          ) : null}
        </div>
      )}

      <SignInButton label={submitLabel} pendingLabel={t('auth.signingIn')} />
    </form>
  );
}
