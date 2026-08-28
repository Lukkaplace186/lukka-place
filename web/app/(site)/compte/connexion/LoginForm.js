'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { getFavoriteIds, getSavedSearches } from '@/lib/localFavorites';

const ERROR_MESSAGES = {
  1: 'Numéro ou mot de passe incorrect.',
  phone: 'Numéro de téléphone invalide.',
  locked: 'Trop de tentatives — réessayez dans 15 minutes.',
};

/**
 * Client wrapper only so the current visitor's anonymous localStorage data
 * (favorites/saved searches) can ride along into the Server Action as
 * hidden fields, right before the native submit — necessarily JS-dependent,
 * since localStorage itself is (a stated divergence from the admin login's
 * JS-free form). The account-side merge itself (loginAction ->
 * mergeAnonymousData) is real and additive, not a decoration.
 */
export default function LoginForm({ action, next, error }) {
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
        <label htmlFor="phone" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
          Numéro de téléphone
        </label>
        <input
          id="phone"
          type="tel"
          name="phone"
          inputMode="tel"
          autoComplete="tel"
          placeholder="099 712 3456"
          autoFocus
          required
          className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-wide text-ink-45">
            Mot de passe
          </label>
          <Link href="/mot-de-passe-oublie?role=customer" className="text-xs font-semibold text-blue-deep hover:underline">
            Mot de passe oublié ?
          </Link>
        </div>
        <input
          id="password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {ERROR_MESSAGES[error] || ERROR_MESSAGES[1]}
        </p>
      )}

      <button
        type="submit"
        className="mt-1 rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
      >
        Se connecter
      </button>
    </form>
  );
}
