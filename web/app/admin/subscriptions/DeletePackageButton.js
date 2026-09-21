'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/Toast';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { deletePackageAction } from './actions';

/**
 * "Supprimer le forfait" on one row of the Forfaits table. The dialog says how
 * many agencies are on an active membership of this plan and that they will be
 * moved to Free — the guard lives in lib/subscriptions.js deletePackage, this
 * only makes it visible before the click.
 */
export default function DeletePackageButton({ pkg }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      let result;
      try {
        result = await deletePackageAction(pkg.id);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      showToast({ type: result.ok ? 'success' : 'error', message: result.ok ? result.message : result.error });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Supprimer le forfait ${pkg.title}`}
        title="Supprimer le forfait"
        className="rounded-md border border-line p-1.5 text-ink-45 hover:border-danger hover:text-danger"
      >
        <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Supprimer le forfait « {pkg.title} »</DialogTitle>
            <DialogDescription>
              Il disparaît des listes et des choix de forfait. L’historique de facturation garde son nom.
            </DialogDescription>
          </DialogHeader>
          {pkg.activeMemberships > 0 ? (
            <p className="rounded-lg bg-warning-tint p-3 text-sm text-ink" role="alert">
              {pkg.activeMemberships} agence(s) ont un abonnement actif sur ce forfait. Elles seront basculées sur le
              forfait Free dès maintenant ; leur abonnement actuel prend fin aujourd’hui.
            </p>
          ) : (
            <p className="text-sm text-ink-70">Aucune agence n’a d’abonnement actif sur ce forfait.</p>
          )}
          <DialogFooter>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="u-press inline-flex h-8 items-center rounded-md border border-line px-3 text-sm font-semibold text-ink hover:bg-canvas-alt"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={confirm}
              className="u-press inline-flex h-8 items-center rounded-md bg-danger px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              {pending ? 'Suppression…' : 'Supprimer le forfait'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
