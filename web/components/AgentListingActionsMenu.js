'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Archive, ArchiveRestore, CircleCheck, CircleDot, Copy, ExternalLink, Megaphone, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import {
  deleteListingAction,
  duplicateListingAction,
  setListingArchivedAction,
  updateListingStatusAction,
} from '@/app/compte/agent/actions';
import { useToast } from './Toast';
import { actionFailureToast } from '@/lib/actionFailure';
import AgentListingShareKit from './AgentListingShareKit';
import { useT } from '@/lib/i18n/client';
import { announceListingQuota } from '@/lib/listingQuotaRules';

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
 * elsewhere (status='active'), which already clears the recorded
 * transaction and revalidates every public surface — there is no separate
 * "republish" action to keep in sync with that one.
 *
 * "Archiver" / "Remettre en vente" is a THIRD, orthogonal thing, and the
 * distinction is worth holding on to:
 *
 *   Marquer loué / vendu   the market state changed, and a real transaction
 *                          (price + date) is recorded against the listing.
 *   Archiver               the listing is simply off the market for now —
 *                          the owner went quiet, the season is over, it's
 *                          being re-photographed. No transaction happened,
 *                          nothing is claimed about why, and nothing is
 *                          deleted.
 *   Supprimer              gone for good.
 *
 * Collapsing the middle one into either neighbour is what forces agents to
 * delete inventory they only wanted to hide.
 */
/*
 * SEVEN ITEMS, in three groups (2026-09-28 — it had grown to ten, mixing the
 * everyday with the occasional): open it (Modifier, Voir l'annonce), make
 * something from it (Marketing & Documents: graphics, the A4 poster and
 * sheet, the owner report — one dialog, AgentListingShareKit), change its
 * state (compromis, Dupliquer, Archiver), then Supprimer on its own.
 * "Partager sur WhatsApp" left the menu for the card itself
 * (AgentListingWhatsAppButton): it is the one thing agents do every day.
 *
 * `onStatusChange` (Mes biens) adds the active ↔ sous compromis switch here:
 * on a phone the row shows its status as a tag and this menu is where it
 * changes (the table's status select is desktop-only). The caller keeps the
 * optimistic update, so the tag moves the moment the item is tapped.
 */
export default function AgentListingActionsMenu({ listing, isClosed, onStatusChange }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareKitOpen, setShareKitOpen] = useState(false);

  // Archived is `status = 0` — the same active/enabled flag the public
  // query filters on. Coerced because bigint/smallint columns arrive from
  // node-postgres as strings often enough that `=== 0` silently never
  // matches.
  const isArchived = Number(listing.status) === 0;

  function handleRepublish() {
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set('listing_status', 'active');
        await updateListingStatusAction(listing.id, formData);
        showToast({ type: 'success', message: t('agent.listings.relisted', { title: listing.title }) });
        router.refresh();
      } catch (err) {
        showToast(actionFailureToast(t, err, handleRepublish));
      }
    });
  }

  function handleToggleArchive() {
    startTransition(async () => {
      let result;
      try {
        result = await setListingArchivedAction(listing.id, !isArchived);
      } catch (err) {
        showToast(actionFailureToast(t, err, handleToggleArchive));
        return;
      }
      if (!result.ok && result.quota) {
        announceListingQuota(result.quota);
        return;
      }
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      showToast({
        type: 'success',
        message: isArchived
          ? t('agent.listings.unarchived', { title: listing.title })
          : t('agent.listings.archived_toast', { title: listing.title }),
      });
      router.refresh();
    });
  }

  function handleDuplicate() {
    startTransition(async () => {
      let result;
      try {
        result = await duplicateListingAction(listing.id);
      } catch (err) {
        // No automatic retry: a duplicate that was created before the
        // connection dropped would be created twice.
        showToast(actionFailureToast(t, err));
        return;
      }
      if (!result.ok && result.quota) {
        announceListingQuota(result.quota);
        return;
      }
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      showToast({ type: 'success', message: t('agent.listings.duplicated') });
      router.push(`/compte/agent/biens/${result.propertyId}/edit`);
      router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      let result;
      try {
        result = await deleteListingAction(listing.id);
      } catch (err) {
        showToast(actionFailureToast(t, err, handleDelete));
        return;
      }
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      showToast({ type: 'success', message: t('agent.listings.deleted', { title: listing.title }) });
      setConfirmDelete(false);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t('agent.listings.actionsFor', { title: listing.title })}
          className="u-press grid h-[2.125rem] w-[2.125rem] place-items-center rounded-lg text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink data-[state=open]:bg-canvas-alt data-[state=open]:text-ink"
        >
          <MoreHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-[1.0625rem] w-[1.0625rem]" />
        </DropdownMenuTrigger>

        {/* collisionPadding keeps the whole menu above the phone's fixed bottom
            nav (AgentSidebar, ~56px + safe area): Radix flips it upward or
            caps its height (it already sets max-h to the available height, and
            scrolls) instead of letting "Supprimer" slide under the nav. */}
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          collisionPadding={{ top: 12, right: 12, bottom: 88, left: 12 }}
          className="w-56 max-w-[calc(100vw-1.5rem)]"
        >
          <DropdownMenuItem asChild>
            <Link href={`/compte/agent/biens/${listing.id}/edit`} className="flex items-center gap-2.5">
              <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-45" />
              {t('agent.listings.edit')}
            </Link>
          </DropdownMenuItem>

          {listing.approve_status === 1 && (
            <DropdownMenuItem asChild>
              <Link href={`/listings/${listing.id}`} target="_blank" className="flex items-center gap-2.5">
                <ExternalLink strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-45" />
                {t('agent.listings.viewPublic')}
              </Link>
            </DropdownMenuItem>
          )}

          <DropdownMenuItem onSelect={() => setShareKitOpen(true)} className="flex items-center gap-2.5">
            <Megaphone strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-45" />
            {t('agent.share.menuItem')}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {onStatusChange && !isClosed && (listing.listing_status === 'under_offer' ? (
            <DropdownMenuItem onSelect={() => onStatusChange('active')} className="flex items-center gap-2.5">
              <CircleCheck strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-success" />
              {t('agent.listings.markActive')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => onStatusChange('under_offer')} className="flex items-center gap-2.5">
              <CircleDot strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-warning" />
              {t('agent.listings.markUnderOfferOne')}
            </DropdownMenuItem>
          ))}

          <DropdownMenuItem onSelect={handleDuplicate} disabled={pending} className="flex items-center gap-2.5">
            <Copy strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-45" />
            {t('agent.listings.duplicate')}
          </DropdownMenuItem>

          {isClosed ? (
            <DropdownMenuItem onSelect={handleRepublish} disabled={pending} className="flex items-center gap-2.5">
              <RotateCcw strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-45" />
              {t('agent.listings.relist')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={handleToggleArchive}
              disabled={pending}
              className="flex items-center gap-2.5"
            >
              {isArchived ? (
                <ArchiveRestore strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-45" />
              ) : (
                <Archive strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-45" />
              )}
              {isArchived ? t('agent.listings.relistForSale') : t('agent.listings.archiveHide')}
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={() => setConfirmDelete(true)}
            className="flex items-center gap-2.5 text-danger focus:text-danger"
          >
            <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('common.actions.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('agent.listings.deleteOne')}</DialogTitle>
            <DialogDescription>{t('agent.listings.deleteOneBody', { title: listing.title })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                className="u-press inline-flex h-11 items-center rounded-lg px-4 text-sm font-semibold text-ink-45 hover:bg-canvas-alt hover:text-ink"
              >
                {t('common.actions.cancel')}
              </button>
            </DialogClose>
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="u-press h-11 rounded-lg bg-danger px-5 text-sm font-bold text-white disabled:opacity-60"
            >
              {pending ? t('agent.listings.deleting') : t('agent.listings.deletePermanently')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AgentListingShareKit listingId={listing.id} open={shareKitOpen} onOpenChange={setShareKitOpen} />
    </>
  );
}
