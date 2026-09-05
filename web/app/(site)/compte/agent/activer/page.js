import Link from 'next/link';
import { BadgeCheck } from 'lucide-react';
import { normalizePhone } from '@/lib/phone';
import { peekAgentActivation } from '@/lib/agents';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { activateAgentAction } from './actions';

export const metadata = {
  title: 'Activer mon compte agent — Lukka Place',
  robots: { index: false, follow: false },
};

const ERROR_MESSAGES = {
  invalid: 'Ce lien n’est plus valable. Renvoyez un message sur WhatsApp pour en recevoir un nouveau.',
  password: 'Choisissez un mot de passe d’au moins 8 caractères.',
  mismatch: 'Les deux mots de passe ne correspondent pas.',
};

/**
 * The landing page of the WhatsApp magic link
 * (services/agentOnboarding.js's activationMessage, engine repo).
 *
 * The account already exists and the phone is already verified by the time
 * anyone reaches this page — the agent created it by answering one question
 * on WhatsApp, and their listings are already in the moderation queue whether
 * they open this link or not. All this page does is set a password so they
 * can sign in from a browser later. That is why there is no OTP field, no
 * phone input, and no "create account" language: nothing here is a
 * registration step, and framing it as one would make an agent think their
 * listing is blocked on it.
 *
 * The token is validated read-only before rendering (peekAgentActivation) so
 * an expired link says so immediately, with a real way forward, instead of
 * presenting a password form that fails on submit.
 */
export default async function AgentActivatePage({ searchParams }) {
  const params = await searchParams;
  const phone = normalizePhone(String(params.phone || ''));
  const token = typeof params.token === 'string' ? params.token : '';
  const error = typeof params.error === 'string' ? params.error : null;

  const { valid, agentName, agencyName } = await peekAgentActivation({ phone, token });

  if (!valid) {
    const href = getCentralWhatsAppHref(
      'Bonjour, mon lien d’activation Lukka Place a expiré. Pouvez-vous m’en envoyer un nouveau ?',
    );
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
        <div className="u-lift w-full max-w-sm rounded-card border border-line bg-surface p-6 sm:p-8">
          <h1 className="u-title-section text-ink">Lien expiré</h1>
          <p className="u-micro mt-2 leading-relaxed text-ink-45">
            Ce lien d’activation n’est plus valable — il a peut-être déjà été utilisé, ou il a dépassé sa durée
            de validité. Vos biens restent enregistrés : seul l’accès au tableau de bord attend.
          </p>
          <div className="mt-6 flex flex-col gap-2.5">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="u-btn-primary u-press inline-flex h-11 items-center justify-center rounded-lg bg-blue px-4 text-sm font-bold text-white"
              >
                Recevoir un nouveau lien sur WhatsApp
              </a>
            ) : null}
            <Link
              href="/compte/agent/connexion"
              className="u-micro-strong inline-flex h-10 items-center justify-center rounded-lg text-ink-45 hover:text-ink"
            >
              J’ai déjà un mot de passe — me connecter
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 py-10">
      <div className="u-lift w-full max-w-sm rounded-card border border-line bg-surface p-6 sm:p-8">
        <span className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-success-tint px-3 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] text-success">
          <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
          Numéro vérifié
        </span>

        <h1 className="u-title-section text-ink">
          {agentName ? `Bienvenue, ${agentName}` : 'Activez votre compte'}
        </h1>
        <p className="u-micro mt-2 leading-relaxed text-ink-45">
          {agencyName ? `${agencyName} · ` : ''}
          Votre compte agent est créé et votre numéro <span className="u-tabular">{phone}</span> est déjà
          vérifié. Choisissez un mot de passe pour accéder à votre tableau de bord.
        </p>

        <form action={activateAgentAction} className="mt-6 flex flex-col gap-3.5">
          <input type="hidden" name="phone" value={phone} />
          <input type="hidden" name="token" value={token} />

          <div>
            <label htmlFor="password" className="u-eyebrow mb-1.5 block text-ink-45">
              Mot de passe
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              autoFocus
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm text-ink"
            />
            <p className="u-micro mt-1.5 text-ink-35">8 caractères minimum.</p>
          </div>

          <div>
            <label htmlFor="password_confirm" className="u-eyebrow mb-1.5 block text-ink-45">
              Confirmer le mot de passe
            </label>
            <input
              id="password_confirm"
              name="password_confirm"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm text-ink"
            />
          </div>

          {error && (
            <p className="u-micro font-semibold text-danger" role="alert">
              {ERROR_MESSAGES[error] || ERROR_MESSAGES.invalid}
            </p>
          )}

          <button
            type="submit"
            className="u-btn-primary u-press mt-1 inline-flex h-11 items-center justify-center rounded-lg bg-blue px-4 text-sm font-bold text-white"
          >
            Activer mon compte
          </button>
        </form>
      </div>
    </div>
  );
}
