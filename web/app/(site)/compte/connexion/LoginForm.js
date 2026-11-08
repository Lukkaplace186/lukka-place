'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { getFavoriteIds, getSavedSearches } from '@/lib/localFavorites';
import { readMoveDraft } from '@/lib/moveDraft';
import { MOVE_STEPS } from '@/lib/moveProjectRules';
import PhoneField from '@/components/PhoneField';
import PasswordInput from '@/components/PasswordInput';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { useLocale, useT } from '@/lib/i18n/client';

// Keys, not text: a module-level constant is evaluated once at import,
// where `t` does not exist — see components/navItems.js.
const ERROR_MESSAGE_KEYS = {
  1: 'auth.errors.badCredentials',
  phone: 'auth.errors.phoneInvalid',
  locked: 'auth.errors.locked',
};

const FORGOT_HREF = '/mot-de-passe-oublie?role=customer';

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

/** The move-card answers on this device, in the shape signupAction reads (`moveProject`). */
function draftProjectValue() {
  const draft = readMoveDraft();
  if (!draft?.answers) return '';
  const answered = new Set(draft.answered || []);
  const answeredSteps = MOVE_STEPS.filter((step) => answered.has(step));
  return answeredSteps.length ? JSON.stringify({ ...draft.answers, answeredSteps }) : '';
}

/**
 * Client wrapper so the visitor's anonymous localStorage data (favourites,
 * saved searches) rides into the Server Action as hidden fields right before
 * submit; loginAction merges them into the account.
 *
 * 2026-11-08 (owner request, sign-in friction review): a refusal comes back
 * as state, so the number stays typed (the field re-opens with it) and the
 * password stays too; the password has a show/hide eye; "too many tries"
 * offers the reset, which unlocks at once; `withProject` (from sign-up's
 * "Se connecter avec ce numéro") sends this device's move answers along.
 */
export default function LoginForm({ action, next, error: initialError, defaultCountry, defaultPhone = '', withProject = false }) {
  const t = useT();
  const locale = useLocale();
  const formRef = useRef(null);
  const [state, formAction] = useActionState(action, null);
  const [password, setPassword] = useState('');
  const [projectValue, setProjectValue] = useState('');
  const error = state ? state.error : initialError;
  const values = state?.values || null;
  const phoneValue = values ? values.phone : defaultPhone;

  // Read after mount: localStorage does not exist on the server.
  useEffect(() => {
    if (withProject) setProjectValue(draftProjectValue());
  }, [withProject]);

  function handleSubmit() {
    const form = formRef.current;
    if (!form) return;
    form.favoriteIds.value = getFavoriteIds().join(',');
    form.savedSearches.value = JSON.stringify(getSavedSearches());
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="favoriteIds" />
      <input type="hidden" name="savedSearches" />
      {projectValue ? <input type="hidden" name="moveProject" value={projectValue} /> : null}
      {projectValue ? (
        <p className="rounded-md bg-green-tint px-3 py-2 text-[0.8125rem] font-semibold text-green-deep">{t('auth.login.keepsAnswers')}</p>
      ) : null}

      <PhoneField
        key={state?.attempt || 'first'}
        name="phone"
        id="phone"
        defaultCountry={(values && values.phoneCountry) || defaultCountry}
        defaultValue={phoneValue}
        // A remembered (or just typed) number is already the right country:
        // browser detection must not swap its dial code.
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

      <SignInButton label={t('common.shared.signIn')} pendingLabel={t('auth.signingIn')} />
    </form>
  );
}
