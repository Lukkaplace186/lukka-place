'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/Toast';
import { deleteAgentAction, getAgentDeletionImpactAction } from './actions';

const BUTTON = 'u-press inline-flex h-8 items-center rounded-md border border-line px-3 text-sm font-semibold text-ink hover:bg-canvas-alt disabled:opacity-50';

/**
 * "Supprimer" for one agent. Loads what the deletion would touch first
 * (listings, closed transactions, documents, commissions still owed), lets the
 * admin choose what happens to the listings, and asks for the agent's id to be
 * typed — a permanent delete should not be one misplaced tap away from
 * "Suspendre" in the same menu.
 */
export default function DeleteAgentDialog({ agent, onClose }) {
  return (
    <Dialog open={Boolean(agent)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {/* Keyed by agent: every opening starts from a clean form. */}
        {agent ? <DeleteAgentBody key={agent.id} agent={agent} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function DeleteAgentBody({ agent, onClose }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [impact, setImpact] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [listings, setListings] = useState('archive');
  const [confirmId, setConfirmId] = useState('');
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getAgentDeletionImpactAction(agent.id)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setImpact(result.impact);
        else setLoadError(result.error);
      })
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  const blocked = impact?.blockingCommissions > 0;
  const canSubmit = impact && !blocked && confirmId.trim() === String(agent.id) && !pending;

  function submit() {
    const formData = new FormData();
    formData.set('listings', listings);
    formData.set('confirm_id', confirmId.trim());
    startTransition(async () => {
      let result;
      try {
        result = await deleteAgentAction(agent.id, formData);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      showToast({ type: result.ok ? 'success' : 'error', message: result.ok ? result.message : result.error });
      if (result.ok) {
        onClose();
        router.refresh();
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Supprimer {agent.name}</DialogTitle>
        <DialogDescription>
          Êtes-vous sûr de vouloir supprimer cet agent ? Cette action est irréversible.
        </DialogDescription>
      </DialogHeader>

      {loadError ? <p className="text-sm text-danger" role="alert">{loadError}</p> : null}
      {!impact && !loadError ? <p className="text-sm text-ink-45" role="status">Calcul de l’impact…</p> : null}

      {impact ? (
        <div className="flex flex-col gap-3 text-sm text-ink-70">
          <ul className="list-disc space-y-0.5 pl-5">
            <li>{impact.listings} annonce(s), dont {impact.liveListings} en ligne et {impact.closedListings} transaction(s) conclue(s)</li>
            <li>{impact.documents} document(s) de vérification — supprimés du stockage</li>
            <li>Son agence et ses abonnements ne sont pas touchés.</li>
          </ul>

          {blocked ? (
            <p className="rounded-lg bg-warning-tint p-3 text-ink" role="alert">
              {impact.blockingCommissions} commission(s) commerciale(s) en attente, approuvée(s) ou payée(s) sont liées à cet agent.
              Annulez-les ou réglez-les dans Commerciaux avant de supprimer le compte.
            </p>
          ) : (
            <>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-45">Ses annonces</legend>
                <label className="flex items-start gap-2">
                  <input type="radio" name="listings" value="archive" checked={listings === 'archive'} onChange={() => setListings('archive')} className="mt-1 accent-blue" />
                  <span><strong className="text-ink">Archiver et détacher</strong> (recommandé) — retirées du site, conservées dans les données du marché.</span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="radio" name="listings" value="delete" checked={listings === 'delete'} onChange={() => setListings('delete')} className="mt-1 accent-blue" />
                  <span>
                    <strong className="text-ink">Supprimer définitivement</strong> — avec leurs photos et textes.
                    {impact.closedListings ? ` Les ${impact.closedListings} transaction(s) conclue(s) sont archivées quand même : le prix obtenu n’existe nulle part ailleurs.` : ''}
                  </span>
                </label>
              </fieldset>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-45">Saisissez {agent.id} pour confirmer</span>
                <input
                  value={confirmId}
                  onChange={(event) => setConfirmId(event.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                  className="u-focus-ring h-9 rounded-lg border border-line bg-surface px-2.5 text-ink"
                />
              </label>
            </>
          )}
        </div>
      ) : null}

      <DialogFooter>
        <button type="button" className={BUTTON} onClick={onClose}>Annuler</button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="u-press inline-flex h-8 items-center rounded-md bg-danger px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          {pending ? 'Suppression…' : 'Supprimer définitivement'}
        </button>
      </DialogFooter>
    </>
  );
}
