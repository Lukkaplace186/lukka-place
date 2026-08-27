import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentProfile, agentDisplayName } from '@/lib/agencies';
import AgentPageHeader from '@/components/AgentPageHeader';
import { changeAgentPasswordAction } from '../actions';

const ERROR_MESSAGES = {
  too_short: 'Le nouveau mot de passe doit contenir au moins 8 caractères.',
  mismatch: 'Les deux mots de passe ne correspondent pas.',
  wrong_password: 'Mot de passe actuel incorrect.',
};

export default async function AgentSettingsPage({ searchParams }) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const success = params.success === '1';

  const agentId = await getCurrentAgentId();
  const agent = await getAgentProfile(agentId);
  const name = agentDisplayName(agent) || '—';

  return (
    <>
      <AgentPageHeader title="Paramètres" subtitle="Vos informations de connexion." />

      <div className="grid grid-cols-1 gap-6 px-5 py-6 sm:px-8 lg:max-w-2xl">
        <div className="rounded-card border border-line bg-white p-6">
          <h2 className="text-sm font-bold text-ink">Identité</h2>
          <dl className="mt-4 flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-ink-45">Nom</dt>
              <dd className="font-semibold text-ink">{name}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-ink-45">Numéro WhatsApp</dt>
              <dd className="font-semibold text-ink">{agent.phone || '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-ink-45">E-mail</dt>
              <dd className="font-semibold text-ink">{agent.email || '—'}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-card border border-line bg-white p-6">
          <h2 className="text-sm font-bold text-ink">Mot de passe</h2>
          <p className="mt-1 text-xs text-ink-45">Changer de mot de passe déconnecte vos autres sessions.</p>

          <form action={changeAgentPasswordAction} className="mt-4 flex flex-col gap-3">
            <div>
              <label htmlFor="current_password" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
                Mot de passe actuel
              </label>
              <input
                id="current_password"
                type="password"
                name="current_password"
                autoComplete="current-password"
                required
                className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label htmlFor="new_password" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
                Nouveau mot de passe
              </label>
              <input
                id="new_password"
                type="password"
                name="new_password"
                autoComplete="new-password"
                placeholder="8 caractères minimum"
                required
                className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label htmlFor="confirm_password" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
                Confirmer
              </label>
              <input
                id="confirm_password"
                type="password"
                name="confirm_password"
                autoComplete="new-password"
                required
                className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
              />
            </div>

            {success && (
              <p className="text-sm text-green-deep" role="status">
                Mot de passe mis à jour.
              </p>
            )}
            {error && (
              <p className="text-sm text-red-600" role="alert">
                {ERROR_MESSAGES[error] || ERROR_MESSAGES.wrong_password}
              </p>
            )}

            <button
              type="submit"
              className="mt-1 self-start rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
            >
              Mettre à jour le mot de passe
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
