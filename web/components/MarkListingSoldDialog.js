'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { markListingSoldAction } from '@/app/compte/agent/actions';
import { useToast } from './Toast';

/**
 * The only path to listing_status = 'closed' (see actions.js's
 * LISTING_STATUSES comment) — collects the real final transaction price
 * before the listing leaves the active market, rather than letting a bare
 * status change silently lose that figure.
 */
export default function MarkListingSoldDialog({ propertyId, purpose, title }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const isRent = purpose === 'rent';
  const verb = isRent ? 'loué' : 'vendu';

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await markListingSoldAction(propertyId, formData);
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      showToast({ type: 'success', message: `« ${title} » marqué comme ${verb}.` });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Marquer ${title} comme ${verb}`}
        title={isRent ? 'Marquer comme loué' : 'Marquer comme vendu'}
        className="u-press grid h-[2.125rem] w-[2.125rem] place-items-center rounded-lg text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink"
      >
        <CheckCircle2 strokeWidth={ICON_STROKE_WIDTH} className="h-[1.0625rem] w-[1.0625rem]" />
      </button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marquer comme {verb} ?</DialogTitle>
          <DialogDescription>
            « {title} » sera retiré des biens actifs et le prix final sera enregistré. Cette information reste
            visible sur votre tableau de bord.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="sold_price" className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
              Prix final ($)
            </label>
            <input
              id="sold_price"
              name="sold_price"
              type="number"
              min="1"
              step="1"
              required
              autoFocus
              className="u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <button type="button" className="u-press inline-flex h-11 items-center rounded-lg px-4 text-sm font-semibold text-ink-45 hover:bg-canvas-alt hover:text-ink">
                Annuler
              </button>
            </DialogClose>
            <button
              type="submit"
              disabled={pending}
              className="u-btn-primary u-press h-11 rounded-lg bg-blue px-5 text-sm font-bold text-white disabled:opacity-60"
            >
              {pending ? 'Enregistrement…' : `Confirmer — marqué ${verb}`}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
