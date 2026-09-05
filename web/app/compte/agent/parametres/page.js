import Link from 'next/link';
import { BadgeCheck, ArrowUpRight, Check, Circle } from 'lucide-react';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { getLocationHierarchySafe } from '@/lib/locations';
import { formatPhoneDisplay } from '@/lib/phone';
import { SITE_URL, ICON_STROKE_WIDTH } from '@/lib/constants';
import AgentAvatarUpload from '@/components/AgentAvatarUpload';
import AgentPageHeader from '@/components/AgentPageHeader';
import {
  updateAgentIdentityAction,
  changeAgentPasswordAction,
  updateOwnCommunesAction,
  updateWorkingHoursAction,
} from '../actions';

const ERROR_MESSAGES = {
  too_short: 'Le nouveau mot de passe doit contenir au moins 8 caractères.',
  mismatch: 'Les deux mots de passe ne correspondent pas.',
  wrong_password: 'Mot de passe actuel incorrect.',
  name_required: 'Renseignez au moins un prénom ou un nom.',
};

export default async function AgentSettingsPage({ searchParams }) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const saved = typeof params.saved === 'string' ? params.saved : null;
  const passwordSuccess = params.success === '1';

  const agentId = await getCurrentAgentId();
  const [{ agent, completion }, { communes, degraded }] = await Promise.all([
    getAgentDashboardContext(agentId),
    getLocationHierarchySafe(),
  ]);

  const profileUrl = `${SITE_URL}/agents/${agent.id}`;
  const selectedCommunes = new Set(agent.primary_communes || []);
  const boundUpdateCommunes = updateOwnCommunesAction.bind(null, communes);

  return (
    <>
      <AgentPageHeader title="Paramètres" newLeadsCount={0} />

      <div className="grid grid-cols-1 gap-6 px-5 py-7 sm:px-8 lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:items-start">
        <div className="flex flex-col gap-6">
        <div className="u-card flex flex-col gap-5 rounded-card bg-surface p-6">
          <div>
            <h2 className="u-title-card text-ink">Identité de l&apos;agence</h2>
            <p className="mt-0.5 text-[0.8125rem] text-ink-45">
              Ce que vos clients voient en haut de votre page publique.
            </p>
          </div>

          <AgentAvatarUpload initialSrc={agent.image} />

          <form action={updateAgentIdentityAction} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="first_name" className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
                  Prénom
                </label>
                <input
                  id="first_name"
                  name="first_name"
                  defaultValue={agent.first_name || ''}
                  className="u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
                />
              </div>
              <div>
                <label htmlFor="last_name" className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
                  Nom
                </label>
                <input
                  id="last_name"
                  name="last_name"
                  defaultValue={agent.last_name || ''}
                  className="u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
                />
              </div>
            </div>

            <div>
              <label htmlFor="bio" className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
                Présentation
              </label>
              <textarea
                id="bio"
                name="bio"
                rows={4}
                defaultValue={agent.bio || ''}
                placeholder="Location et vente de maisons, appartements et parcelles à Kinshasa."
                className="u-focus-ring w-full resize-y rounded-lg border border-line bg-surface p-3 text-sm leading-relaxed text-ink placeholder:text-ink-35"
              />
            </div>

            <div>
              <span className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">Numéro WhatsApp</span>
              <div className="flex h-11 items-center gap-2 rounded-lg border border-line bg-canvas-alt px-3 text-sm text-ink-45">
                <span className="u-tabular text-ink">{formatPhoneDisplay(agent.phone) || 'Non renseigné'}</span>
                {agent.phone_verified_at && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                    <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                    Vérifié
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xs text-ink-35">
                C&apos;est ce numéro qui reçoit les demandes et qui vous identifie à la connexion. Le changer demande
                une nouvelle vérification par code — contactez l&apos;équipe Lukka Place.
              </p>
            </div>

            {saved === 'identity' && (
              <p className="text-sm font-semibold text-success" role="status">
                Modifications enregistrées.
              </p>
            )}
            {error === 'name_required' && (
              <p className="text-sm font-semibold text-danger" role="alert">
                {ERROR_MESSAGES.name_required}
              </p>
            )}

            <div className="flex gap-2.5">
              <button
                type="submit"
                className="u-btn-primary u-press h-11 rounded-lg bg-blue px-5 text-sm font-bold text-white"
              >
                Enregistrer les modifications
              </button>
              <Link
                href="/compte/agent/parametres"
                className="u-press inline-flex h-11 items-center rounded-lg px-4 text-sm font-semibold text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink"
              >
                Annuler
              </Link>
            </div>
          </form>
        </div>

        <div className="u-card flex flex-col gap-4 rounded-card bg-surface p-6">
          <div>
            <h2 className="u-title-card text-ink">Communes couvertes</h2>
            <p className="mt-0.5 text-[0.8125rem] text-ink-45">
              Les communes où vous proposez des biens, affichées sur votre page publique.
            </p>
          </div>

          {degraded ? (
            <p className="text-[0.8125rem] text-ink-45">
              Liste des communes indisponible pour le moment. Réessayez plus tard.
            </p>
          ) : (
            <form action={boundUpdateCommunes} className="flex flex-col gap-4">
              <div className="grid max-h-56 grid-cols-2 gap-x-4 gap-y-2 overflow-y-auto sm:grid-cols-3">
                {communes.map((commune) => (
                  <label key={commune} className="flex items-center gap-2 text-[0.8125rem] text-ink-70">
                    <input type="checkbox" name="communes" value={commune} defaultChecked={selectedCommunes.has(commune)} />
                    {commune}
                  </label>
                ))}
              </div>

              {saved === 'communes' && (
                <p className="text-sm font-semibold text-success" role="status">
                  Communes mises à jour.
                </p>
              )}

              <button
                type="submit"
                className="u-btn-primary u-press h-10 self-start rounded-lg bg-blue px-5 text-sm font-bold text-white"
              >
                Enregistrer
              </button>
            </form>
          )}
        </div>

        <div className="u-card flex flex-col gap-4 rounded-card bg-surface p-6">
          <div>
            <h2 className="u-title-card text-ink">Horaires</h2>
            <p className="mt-0.5 text-[0.8125rem] text-ink-45">
              Vos jours et heures de disponibilité, affichés sur votre page publique.
            </p>
          </div>

          <form action={updateWorkingHoursAction} className="flex flex-col gap-3">
            <input
              type="text"
              name="working_hours"
              defaultValue={agent.working_hours || ''}
              placeholder="Lundi–Samedi, 8h–19h"
              maxLength={200}
              className="u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-35"
            />

            {saved === 'hours' && (
              <p className="text-sm font-semibold text-success" role="status">
                Horaires mis à jour.
              </p>
            )}

            <button
              type="submit"
              className="u-btn-secondary u-press h-10 self-start rounded-lg px-5 text-sm font-bold text-ink"
            >
              Enregistrer
            </button>
          </form>
        </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="u-card flex flex-col gap-4 rounded-card bg-surface p-6">
            <h2 className="u-title-card text-ink">Mot de passe</h2>

            <form action={changeAgentPasswordAction} className="flex flex-col gap-3">
              {[
                { id: 'current_password', label: 'Mot de passe actuel', autoComplete: 'current-password' },
                { id: 'new_password', label: 'Nouveau mot de passe', autoComplete: 'new-password', placeholder: '8 caractères minimum' },
                { id: 'confirm_password', label: 'Confirmer', autoComplete: 'new-password' },
              ].map((field) => (
                <div key={field.id}>
                  <label htmlFor={field.id} className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
                    {field.label}
                  </label>
                  <input
                    id={field.id}
                    name={field.id}
                    type="password"
                    autoComplete={field.autoComplete}
                    placeholder={field.placeholder}
                    required
                    className="u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-35"
                  />
                </div>
              ))}

              {passwordSuccess && (
                <p className="text-sm font-semibold text-success" role="status">
                  Mot de passe mis à jour.
                </p>
              )}
              {error && error !== 'name_required' && (
                <p className="text-sm font-semibold text-danger" role="alert">
                  {ERROR_MESSAGES[error] || ERROR_MESSAGES.wrong_password}
                </p>
              )}

              <button
                type="submit"
                className="u-btn-secondary u-press mt-1 h-11 w-full rounded-lg text-sm font-bold text-ink"
              >
                Mettre à jour le mot de passe
              </button>
            </form>
          </div>

          <div className="u-card flex flex-col gap-4 rounded-card bg-surface p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="u-title-card text-ink">Votre page publique</h2>
              <span className="u-tabular text-[0.8125rem] font-bold text-blue">{completion.percent} %</span>
            </div>

            <div className="h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-blue" style={{ width: `${completion.percent}%` }} />
            </div>

            <ul className="flex flex-col gap-2 text-[0.8125rem]">
              {completion.items.map((item) => (
                <li key={item.label} className="flex items-center gap-2">
                  {item.done ? (
                    <Check strokeWidth={2.5} className="h-4 w-4 shrink-0 text-success" />
                  ) : (
                    <Circle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-25" />
                  )}
                  <span className={item.done ? 'text-ink-45 line-through decoration-ink-25' : 'text-ink-70'}>
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>

            <Link
              href={`/agents/${agent.id}`}
              target="_blank"
              className="u-press inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-line text-[0.8125rem] font-bold text-ink transition-colors hover:bg-canvas-alt"
            >
              Voir ma page
              <ArrowUpRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            </Link>
            <p className="truncate text-xs text-ink-35">{profileUrl}</p>
          </div>
        </div>
      </div>
    </>
  );
}
