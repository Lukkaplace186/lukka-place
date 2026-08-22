'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * Real confirmation before an irreversible action (cascades to
 * customer_favorites/customer_saved_searches via FK — see
 * compte/actions.js's deleteAccountAction). A bare submit button here would
 * be one accidental tap from a permanent, unrecoverable delete.
 */
export default function DeleteAccountButton({ action }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-red-600 hover:underline"
      >
        <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
        Supprimer mon compte
      </button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer votre compte ?</DialogTitle>
          <DialogDescription>
            Vos favoris et recherches sauvegardées seront définitivement supprimés. Cette action est irréversible.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink-70 hover:bg-canvas-alt">
              Annuler
            </button>
          </DialogClose>
          <form action={action}>
            <button type="submit" className="w-full rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
              Supprimer définitivement
            </button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
