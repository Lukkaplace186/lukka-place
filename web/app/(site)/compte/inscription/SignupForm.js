'use client';

import { useRef } from 'react';
import { getFavoriteIds, getSavedSearches } from '@/lib/localFavorites';
import PhoneField from '@/components/PhoneField';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { useLocale, useT } from '@/lib/i18n/client';

// Keys, not text: a module-level constant is evaluated once at import,
// where `t` does not exist — see components/navItems.js.
const ERROR_MESSAGE_KEYS = {
  phone: 'auth.errors.phoneInvalid',
  password: 'auth.errors.passwordMin8',
  exists: 'auth.errors.accountExists',
  expired_attempt: 'auth.errors.expiredAttempt',
};

/**
 * Same reasoning as LoginForm.js: reads the current visitor's anonymous
 * favorites/saved searches into hidden fields right before submit, so
 * signupAction can merge them into the brand-new account.
 */
export default function SignupForm({ action, next, error, initialPhone = '', initialCountry = '' }) {
  const t = useT();
  const locale = useLocale();
  const formRef = useRef(null);

  function handleSubmit() {
    const form = formRef.current;
    if (!form) return;
    form.favoriteIds.value = getFavoriteIds().join(',');
    form.savedSearches.value = JSON.stringify(getSavedSearches());
  }

  return (
    <form ref={formRef} action={action} onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="favoriteIds" />
      <input type="hidden" name="savedSearches" />

      <div>
        <label htmlFor="fullName" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
          {t('enquiry.nameOptional')}
        </label>
        <input
          id="fullName"
          type="text"
          name="fullName"
          autoComplete="name"
          className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
        />
      </div>

      <PhoneField
        name="phone"
        id="phone"
        defaultValue={initialPhone}
        defaultCountry={initialCountry || undefined}
        locale={locale}
        labels={phoneFieldLabels(t)}
        hint={t('auth.signup.codeWillBeSent')}
        autoFocus
        required
      />

      <div>
        <label htmlFor="password" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
          {t('auth.password')}
        </label>
        <input
          id="password"
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={8}
          required
          className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
        />
        <p className="mt-1 text-xs text-ink-45">{t('auth.minEightChars')}</p>
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {(ERROR_MESSAGE_KEYS[error] ? t(ERROR_MESSAGE_KEYS[error]) : null) || t('common.shared.somethingWentWrong')}
        </p>
      )}

      <button
        type="submit"
        className="mt-1 rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
      >
        {t('auth.createMyAccount')}
      </button>
    </form>
  );
}
