import { redirect } from 'next/navigation';
import { verifyResetOtpAction, resendResetOtpAction } from './actions';
import { getResetAttempt } from '@/lib/resetAttempt';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { formatPhoneDisplay } from '@/lib/phone';

export const metadata = {
  title: 'Vérification — Lukka Place',
  robots: { index: false, follow: false },
};

const ERROR_MESSAGES = {
  invalid: 'Code incorrect.',
  expired: 'Ce code a expiré — demandez-en un nouveau.',
  mismatch: 'Les mots de passe ne correspondent pas.',
  weak_password: 'Le mot de passe doit contenir au moins 8 caractères.',
  send_failed: "Impossible d'envoyer un nouveau code pour le moment.",
};

/** "+243 99 712 3456" -> "+243 99 •• 3456" — enough to confirm the right account without showing the full number back. */
function maskPhone(display) {
  return display.replace(/(\+\d{3} \d{2}) \d{3} (\d{4})/, '$1 •• $2');
}

export default async function ResetVerifyPage({ searchParams }) {
  const attempt = await getResetAttempt();
  if (!attempt) {
    redirect('/mot-de-passe-oublie?error=expired_attempt');
  }

  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const sent = params.sent === '1';

  const whatsappHref = getCentralWhatsAppHref(
    "Bonjour, je n'arrive pas à recevoir mon code de réinitialisation de mot de passe sur Lukka Place.",
  );

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 u-lift sm:p-8">
        <h1 className="u-title-section text-ink">Nouveau mot de passe</h1>
        <p className="mt-1 text-sm text-ink-45">
          Entrez le code à 6 chiffres envoyé sur WhatsApp au {maskPhone(formatPhoneDisplay(attempt.phone))}.
          {sent ? ' Un nouveau code a été envoyé.' : ''}
        </p>

        <form action={verifyResetOtpAction} className="mt-6 flex flex-col gap-3">
          <div>
            <label htmlFor="code" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              Code de vérification
            </label>
            <input
              id="code"
              type="text"
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoFocus
              required
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-center text-lg tracking-[0.3em] text-ink"
            />
          </div>

          <div>
            <label htmlFor="newPassword" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              Nouveau mot de passe
            </label>
            <input
              id="newPassword"
              type="password"
              name="newPassword"
              autoComplete="new-password"
              minLength={8}
              required
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
            />
            <p className="mt-1 text-xs text-ink-45">8 caractères minimum.</p>
          </div>

          <div>
            <label htmlFor="confirmPassword" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              Confirmer le mot de passe
            </label>
            <input
              id="confirmPassword"
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              minLength={8}
              required
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {ERROR_MESSAGES[error] || 'Une erreur est survenue.'}
            </p>
          )}

          <button
            type="submit"
            className="mt-1 rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
          >
            Réinitialiser le mot de passe
          </button>
        </form>

        <form action={resendResetOtpAction} className="mt-3 text-center">
          <button type="submit" className="text-sm text-ink-45 underline hover:text-ink">
            Code non reçu ? Réessayer via WhatsApp
          </button>
        </form>

        {whatsappHref && (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="u-btn-secondary mt-4 flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-ink-70"
          >
            Contacter le support WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}
