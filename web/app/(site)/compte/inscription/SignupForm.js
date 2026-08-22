'use client';

import { useRef } from 'react';
import { getFavoriteIds, getSavedSearches } from '@/lib/localFavorites';

const ERROR_MESSAGES = {
  phone: 'Numéro de téléphone invalide.',
  password: 'Le mot de passe doit contenir au moins 8 caractères.',
  exists: 'Un compte existe déjà avec ce numéro.',
};

/**
 * Same reasoning as LoginForm.js: reads the current visitor's anonymous
 * favorites/saved searches into hidden fields right before submit, so
 * signupAction can merge them into the brand-new account.
 */
export default function SignupForm({ action, next, error }) {
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
          Nom (facultatif)
        </label>
        <input
          id="fullName"
          type="text"
          name="fullName"
          autoComplete="name"
          className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:border-blue focus:outline-none"
        />
      </div>

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
          className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:border-blue focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
          Mot de passe
        </label>
        <input
          id="password"
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={8}
          required
          className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:border-blue focus:outline-none"
        />
        <p className="mt-1 text-xs text-ink-45">8 caractères minimum.</p>
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {ERROR_MESSAGES[error] || 'Une erreur est survenue.'}
        </p>
      )}

      <button
        type="submit"
        className="mt-1 rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep"
      >
        Créer mon compte
      </button>
    </form>
  );
}
