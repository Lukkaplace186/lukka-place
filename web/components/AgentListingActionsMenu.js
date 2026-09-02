'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Copy, ExternalLink, MessageCircle, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { buildWhatsAppShareLink, buildListingShareMessage } from '@/lib/whatsapp';
import { deleteListingAction, duplicateListingAction, updateListingStatusAction } from '@/app/compte/agent/actions';
import { useToast } from './Toast';

/**
 * The full per-listing management suite, replacing the row's old icon trio
 * (and, specifically, replacing the "demander une modification sur
 * WhatsApp" link — an agent now edits their own inventory natively).
 *
 * Radix nests badly here in one specific way worth knowing: a Dialog
 * rendered *inside* a DropdownMenuItem unmounts with the menu the moment
 * the item is selected, so the dialog never opens. Both dialogs below are
 * therefore siblings of the menu, driven by state the menu items set — the
 * standard Radix pattern for menu-triggered dialogs.
 *
 * "Marquer comme loué / vendu" is deliberately NOT here: it needs a real
 * final price, which MarkListingSoldDialog collects, and that dialog stays
 * its own control on the row (see actions.js's LISTING_STATUSES comment for
 * why 'closed' can only be reached through it).
 *
 * "Remettre en ligne" is the reverse path, for a listing already closed: it
 * calls the same updateListingStatusAction the per-row status select uses
 * elsewhere (status='active'), which already clears sold_price and
 * revalidates every public surface — there is no separate "republish"
 * action to keep in sync with that one.
 */
export default function AgentListingActionsMenu({ listing, isClosed }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleRepublish() {
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set('listing_status', 'active');
        await updateListingStatusAction(listing.id, formData);
        showToast({ type: 'success', message: `« ${listing.title} » remis en ligne.` });
        router.refresh();
      } catch (err) {
        showToast({ type: 'error', message: err.message || "Échec de la remise en ligne." });
      }
    });
  }

  const shareHref = buildWhatsAppShareLink(
    buildListingShareMessage({
      title: listing.title,
      price: listing.price,
      purpose: listing.purpose,
      pricePeriod: listing.price_period,
      id: listing.id,
    }),
  );

  function handleDuplicate() {
    startTransition(async () => {
      const result = await duplicateListingAction(listing.id);
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      showToast({ type: 'success', message: 'Copie créée — en attente de validation.' });
      router.push(`/compte/agent/biens/${result.propertyId}/edit`);
      router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteListingAction(listing.id);
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      showToast({ type: 'success', message: `« ${listing.title} » supprimé.` });
      setConfirmDelete(false);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions pour ${listing.title}`}
          className="u-press grid h-[2.125rem] w-[2.125rem] place-items-center rounded-lg text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink data-[state=open]:bg-canvas-alt data-[state=open]:text-ink"
        >
          <MoreHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-[1.0625rem] w-[1.0625rem]" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem asChild>
            <Link href={`/compte/agent/biens/${listing.id}/edit`} className="flex items-center gap-2.5">
              <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-45" />
              Modifier
            </Link>
          </DropdownMenuItem>

          {listing.approve_status === 1 && (
            <DropdownMenuItem asChild>
              <Link href={`/listings/${listing.id}`} target="_blank" className="flex items-center gap-2.5">
                <ExternalLink strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-45" />
                Voir l’annonce publique
              </Link>
            </DropdownMenuItem>
          )}

          <DropdownMenuItem onSelect={handleDuplicate} disabled={pending} className="flex items-center gap-2.5">
            <Copy strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-45" />
            Dupliquer
          </DropdownMenuItem>

          <DropdownMenuItem asChild>
            <a
              href={shareHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5"
            >
              <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-45" />
              Partager sur WhatsApp
            </a>
          </DropdownMenuItem>

          {isClosed ? (
            <DropdownMenuItem onSelect={handleRepublish} disabled={pending} className="flex items-center gap-2.5">
              <RotateCcw strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-45" />
              Remettre en ligne
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={() => setConfirmDelete(true)}
            className="flex items-center gap-2.5 text-danger focus:text-danger"
          >
            <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer ce bien ?</DialogTitle>
            <DialogDescription>
              « {listing.title} » et ses photos seront définitivement retirés du site. Cette action est
              irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                className="u-press inline-flex h-11 items-center rounded-lg px-4 text-sm font-semibold text-ink-45 hover:bg-canvas-alt hover:text-ink"
              >
                Annuler
              </button>
            </DialogClose>
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="u-press h-11 rounded-lg bg-danger px-5 text-sm font-bold text-white disabled:opacity-60"
            >
              {pending ? 'Suppression…' : 'Supprimer définitivement'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
