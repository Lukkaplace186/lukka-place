import Link from 'next/link';
import { requestResetAction } from './actions';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';

export const metadata = {
  title: 'Mot de passe oublié — Lukka Place',
  robots: { index: false, follow: false },
};

const ERROR_MESSAGES = {
  phone: 'Numéro de téléphone invalide.',
  send_failed: "Impossible d'envoyer un code pour le moment.",
};

/**
 * Step 1 of 2 (see ./verifier/page.js). Deliberately doesn't prefill the
 * phone field from a query param on error — same convention
 * compte/inscription's SignupForm.js already uses (no prefill there either)
 * and it keeps a real phone number out of the URL even on the failure path.
 */
export default async function ForgotPasswordPage({ searchParams }) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const role = params.role === 'agent' ? 'agent' : 'customer';

  const whatsappHref = getCentralWhatsAppHref(
    "Bonjour, je n'arrive pas à réinitialiser mon mot de passe sur Lukka Place.",
  );

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 u-lift sm:p-8">
        <h1 className="font-display text-2xl font-normal tracking-[-0.01em] text-ink">Mot de passe oublié</h1>
        <p className="mt-1 text-sm text-ink-45">
          Entrez votre numéro de téléphone — un code de vérification vous sera envoyé sur WhatsApp.
        </p>

        <form action={requestResetAction} className="mt-6 flex flex-col gap-3">
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

          <fieldset>
            <legend className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">Je suis</legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-sm text-ink-70">
                <input type="radio" name="role" value="customer" defaultChecked={role === 'customer'} className="accent-blue" />
                Client
              </label>
              <label className="flex items-center gap-1.5 text-sm text-ink-70">
                <input type="radio" name="role" value="agent" defaultChecked={role === 'agent'} className="accent-blue" />
                Agent
              </label>
            </div>
          </fieldset>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {ERROR_MESSAGES[error] || 'Une erreur est survenue.'}
            </p>
          )}

          <button
            type="submit"
            className="mt-1 rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
          >
            Recevoir un code
          </button>
        </form>

        {error === 'send_failed' && whatsappHref && (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="u-btn-secondary mt-3 flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-ink-70"
          >
            Contacter le support WhatsApp
          </a>
        )}

        <p className="mt-5 text-center text-sm text-ink-45">
          <Link href="/compte/connexion" className="font-semibold text-blue-deep hover:underline">
            Retour à la connexion
          </Link>
        </p>
      </div>
    </div>
  );
}
