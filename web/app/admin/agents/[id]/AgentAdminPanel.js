'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, LogOut, Save, ArrowRightLeft } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useToast } from '@/components/Toast';
import {
  adminSaveAgentAction,
  adminResetAgentAccessAction,
  adminRevokeAgentSessionsAction,
  adminReassignListingsAction,
} from './actions';

const FIELD = 'u-focus-ring h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink';
const LABEL = 'u-eyebrow mb-1.5 block text-ink-45';

/**
 * Territory picker.
 *
 * Two lists, because they mean two different things and the lead matcher
 * scores them differently (services/agentRanking.js: +50 for a specialty,
 * +20 for coverage):
 *
 *   Spécialités  where this agency actually knows the market. Shown on their
 *                public profile. Ranked first for a matching request.
 *   Couverture   where they will still take a lead. Wider by definition.
 *
 * Ticking a specialty implies coverage — the server action unions the two, so
 * an agency cannot end up specialising somewhere it doesn't cover, which the
 * ranking query would resolve arbitrarily.
 */
function CommuneGrid({ name, communes, selected, disabled = new Set() }) {
  const chosen = new Set(selected || []);
  return (
    <div className="grid max-h-56 grid-cols-2 gap-x-3 gap-y-1.5 overflow-y-auto rounded-lg border border-line bg-canvas-alt p-3 sm:grid-cols-3">
      {communes.map((commune) => {
        const isDisabled = disabled.has(commune);
        return (
          <label
            key={commune}
            className={`u-micro flex items-center gap-2 ${isDisabled ? 'text-ink-35' : 'text-ink-70'}`}
            title={isDisabled ? 'Déjà couvert : c’est une spécialité de cette agence.' : undefined}
          >
            <input
              type="checkbox"
              name={name}
              value={commune}
              defaultChecked={chosen.has(commune) || isDisabled}
              disabled={isDisabled}
              className="h-3.5 w-3.5 rounded-sm accent-[var(--blue)]"
            />
            <span className="truncate">{commune}</span>
          </label>
        );
      })}
    </div>
  );
}

export default function AgentAdminPanel({ agent, communes, otherAgents, listingCount }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [primary, setPrimary] = useState(new Set(agent.primary_communes || []));

  function run(fn, onOk) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      showToast({ type: 'success', message: onOk(result) });
      router.refresh();
    });
  }

  function handleSave(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setPrimary(new Set(formData.getAll('primary_communes').map(String)));
    run(() => adminSaveAgentAction(agent.id, communes, formData), () => 'Profil agent mis à jour.');
  }

  function handleReassign(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    run(
      () => adminReassignListingsAction(agent.id, formData),
      (r) => `${r.moved} bien${r.moved === 1 ? '' : 's'} transféré${r.moved === 1 ? '' : 's'}.`,
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSave} className="u-card flex flex-col gap-5 rounded-card bg-surface p-6">
        <h2 className="u-title-card text-ink">Identité et territoire</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className={LABEL}>Nom de l’agence</span>
            <input name="agency_name" defaultValue={agent.agency_name || ''} className={FIELD} />
          </div>
          <div>
            <span className={LABEL}>Email</span>
            <input name="email" type="email" defaultValue={agent.email || ''} className={FIELD} />
          </div>
          <div>
            <span className={LABEL}>Statut du compte</span>
            <select name="status" defaultValue={agent.status} className={FIELD}>
              <option value={1}>Actif</option>
              <option value={0}>Suspendu</option>
            </select>
          </div>
          <div>
            <span className={LABEL}>Numéro WhatsApp</span>
            <input
              value={agent.phone || '—'}
              readOnly
              disabled
              className={`${FIELD} cursor-not-allowed bg-canvas-alt text-ink-45`}
            />
            <p className="u-micro mt-1.5 text-ink-35">
              Non modifiable : c’est l’identifiant principal du compte (attribution des annonces,
              vérification, sessions).
            </p>
          </div>
        </div>

        <label className="flex items-start gap-2.5 rounded-lg bg-canvas-alt px-3.5 py-3">
          <input
            type="checkbox"
            name="phone_verified"
            defaultChecked={!!agent.phone_verified_at}
            className="mt-0.5 h-4 w-4 rounded-sm accent-[var(--blue)]"
          />
          <span className="u-micro text-ink-70">
            <span className="font-bold text-ink">Numéro vérifié</span> — badge public et condition
            d’attribution automatique des annonces. Décochez uniquement si le numéro s’avère ne pas
            appartenir à cette agence.
          </span>
        </label>

        <div>
          <span className={LABEL}>Spécialités (communes principales)</span>
          <CommuneGrid name="primary_communes" communes={communes} selected={agent.primary_communes} />
        </div>

        <div>
          <span className={LABEL}>Couverture (autres communes acceptées)</span>
          <CommuneGrid
            name="serviced_communes"
            communes={communes}
            selected={agent.serviced_communes}
            disabled={primary}
          />
          <p className="u-micro mt-1.5 text-ink-45">
            Les spécialités sont automatiquement couvertes. La couverture décide quelles demandes clients
            sont poussées à cette agence ; les spécialités décident de son classement.
          </p>
        </div>

        <div>
          <button
            type="submit"
            disabled={pending}
            className="u-btn-primary u-press inline-flex h-10 items-center gap-2 rounded-lg bg-blue px-4 text-[0.8125rem] font-bold text-white disabled:opacity-60"
          >
            <Save strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>

      <div className="u-card flex flex-col gap-4 rounded-card bg-surface p-6">
        <h2 className="u-title-card text-ink">Accès et sécurité</h2>
        <div className="u-micro grid gap-2 text-ink-70 sm:grid-cols-2">
          <div>
            Mot de passe défini : <strong>{agent.has_password ? 'oui' : 'non'}</strong>
          </div>
          <div>
            Inscription : <strong>{agent.onboarding_source === 'whatsapp' ? 'WhatsApp' : 'Site web'}</strong>
          </div>
          <div>
            Échecs de connexion : <strong>{agent.failed_login_count ?? 0}</strong>
          </div>
          <div>
            Compte verrouillé : <strong>{agent.locked_until ? 'oui' : 'non'}</strong>
          </div>
        </div>

        <div className="flex flex-wrap gap-2.5 border-t border-line pt-4">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () => adminResetAgentAccessAction(agent.id),
                () => 'Lien de réinitialisation envoyé sur WhatsApp.',
              )
            }
            className="u-btn-primary u-press inline-flex h-10 items-center gap-2 rounded-lg bg-blue px-4 text-[0.8125rem] font-bold text-white disabled:opacity-60"
          >
            <KeyRound strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            Envoyer un lien de connexion WhatsApp
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () => adminRevokeAgentSessionsAction(agent.id),
                () => 'Toutes les sessions de cet agent ont été fermées.',
              )
            }
            className="u-btn-secondary u-press inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[0.8125rem] font-bold text-ink disabled:opacity-60"
          >
            <LogOut strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            Fermer toutes les sessions
          </button>
        </div>
        <p className="u-micro text-ink-45">
          Le lien de connexion remplace un mot de passe temporaire : il part sur le numéro déjà vérifié de
          l’agence, ferme toutes ses sessions en cours, et personne chez Lukka Place ne connaît son mot de
          passe.
        </p>
      </div>

      <form onSubmit={handleReassign} className="u-card flex flex-col gap-4 rounded-card bg-surface p-6">
        <h2 className="u-title-card text-ink">Transférer le portefeuille</h2>
        <p className="u-micro text-ink-45">
          Déplace les {listingCount} bien{listingCount === 1 ? '' : 's'} de cette agence vers une autre. À
          faire avant de suspendre un compte : sans agent attribué, chaque annonce retombe sur le numéro
          WhatsApp central.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <span className={LABEL}>Agent de destination</span>
            <select name="to_agent_id" defaultValue="" className={FIELD} required>
              <option value="" disabled>
                Choisir un agent…
              </option>
              {otherAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={pending || listingCount === 0}
            className="u-btn-secondary u-press inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[0.8125rem] font-bold text-ink disabled:opacity-40"
          >
            <ArrowRightLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            Transférer
          </button>
        </div>
      </form>
    </div>
  );
}
