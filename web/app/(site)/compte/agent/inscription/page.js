import Link from 'next/link';
import { agentSignupAction } from './actions';

export const metadata = {
  title: 'Créer un compte agent — Lukka Place',
  robots: { index: false, follow: false },
};

const ERROR_MESSAGES = {
  name: 'Indiquez le nom de votre agence ou votre nom complet.',
  phone: 'Numéro de téléphone invalide.',
  password: 'Le mot de passe doit contenir au moins 8 caractères.',
  exists: 'Un compte existe déjà avec ce numéro.',
  otp_failed: "L'envoi du code de vérification a échoué — réessayez.",
};

export default async function AgentSignupPage({ searchParams }) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const next = typeof params.next === 'string' ? params.next : '/compte/agent';

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 u-lift sm:p-8">
        <h1 className="font-display text-2xl font-normal tracking-[-0.01em] text-ink">Créer un compte agent</h1>
        <p className="mt-1 text-sm text-ink-45">
          Un code de vérification sera envoyé sur WhatsApp à ce numéro.
        </p>

        <form action={agentSignupAction} className="mt-6 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />

          <div>
            <label htmlFor="full_name" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              Nom complet
            </label>
            <input
              id="full_name"
              type="text"
              name="full_name"
              autoComplete="organization"
              placeholder="Ex. Espace Kin Immobilier"
              autoFocus
              required
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
            />
          </div>

          <div>
            <label htmlFor="phone" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              Numéro WhatsApp
            </label>
            <input
              id="phone"
              type="tel"
              name="phone"
              inputMode="tel"
              autoComplete="tel"
              placeholder="099 712 3456"
              required
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
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
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {ERROR_MESSAGES[error] || ERROR_MESSAGES.phone}
            </p>
          )}

          <button
            type="submit"
            className="mt-1 rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
          >
            Recevoir mon code
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-45">
          Déjà un compte ?{' '}
          <Link
            href={`/compte/agent/connexion?next=${encodeURIComponent(next)}`}
            className="font-semibold text-blue-deep hover:underline"
          >
            Se connecter
          </Link>
        </p>
      </div>
    </div>
  );
}
