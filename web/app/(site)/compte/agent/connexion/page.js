import Link from 'next/link';
import { agentLoginAction } from './actions';

export const metadata = {
  title: 'Connexion agent — Lukka Place',
  robots: { index: false, follow: false },
};

const ERROR_MESSAGES = {
  1: 'Numéro ou mot de passe incorrect.',
  phone: 'Numéro de téléphone invalide.',
  locked: 'Trop de tentatives — réessayez dans 15 minutes.',
  otp_failed: "L'envoi du code de vérification a échoué — réessayez.",
};

/**
 * Plain HTML form, no client wrapper — unlike the customer LoginForm.js,
 * there's no localStorage anonymous-data merge to carry across submit here.
 */
export default async function AgentLoginPage({ searchParams }) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const reset = params.reset === '1';
  const next = typeof params.next === 'string' ? params.next : '/compte/agent';

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 u-lift sm:p-8">
        <h1 className="font-display text-2xl font-normal tracking-[-0.01em] text-ink">Espace agent</h1>
        <p className="mt-1 text-sm text-ink-45">Gérez vos annonces et vos prospects.</p>

        <form action={agentLoginAction} className="mt-6 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />

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
              <Link href="/mot-de-passe-oublie?role=agent" className="text-xs font-semibold text-blue-deep hover:underline">
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

          {reset && (
            <p className="text-sm text-green-deep" role="status">
              Mot de passe réinitialisé — connectez-vous avec votre nouveau mot de passe.
            </p>
          )}

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

        <p className="mt-5 text-center text-sm text-ink-45">
          Pas encore de compte agent ?{' '}
          <Link
            href={`/compte/agent/inscription?next=${encodeURIComponent(next)}`}
            className="font-semibold text-blue-deep hover:underline"
          >
            Créer un compte
          </Link>
        </p>
      </div>
    </div>
  );
}
