import { agentVerifyOtpAction, agentResendOtpAction } from './actions';
import ResendButton from './ResendButton';

export const metadata = {
  title: 'Vérification — Lukka Place',
  robots: { index: false, follow: false },
};

const ERROR_MESSAGES = {
  1: 'Code incorrect.',
  expired: 'Ce code a expiré — demandez-en un nouveau.',
};

export default async function AgentVerifyOtpPage({ searchParams }) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const sent = params.sent === '1';
  const next = typeof params.next === 'string' ? params.next : '/compte/agent';
  const agentId = typeof params.agent === 'string' ? params.agent : '';

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 u-lift sm:p-8">
        <h1 className="font-display text-2xl font-normal tracking-[-0.01em] text-ink">Vérification du numéro</h1>
        <p className="mt-1 text-sm text-ink-45">
          Entrez le code à 6 chiffres reçu sur WhatsApp.
          {sent ? ' Un nouveau code a été envoyé.' : ''}
        </p>

        <form action={agentVerifyOtpAction} className="mt-6 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="agent" value={agentId} />

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

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {ERROR_MESSAGES[error] || ERROR_MESSAGES[1]}
            </p>
          )}

          <button
            type="submit"
            className="mt-1 rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
          >
            Vérifier
          </button>
        </form>

        <form action={agentResendOtpAction} className="mt-3 text-center">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="agent" value={agentId} />
          <ResendButton key={sent ? 'sent' : 'initial'} />
        </form>
      </div>
    </div>
  );
}
