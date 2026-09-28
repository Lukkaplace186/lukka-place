'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Archive, ArchiveRestore, CheckCircle2, CircleCheck, CircleDot, Copy, ExternalLink, Megaphone, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import MarkListingSoldDialog from './MarkListingSoldDialog';
import AgentListingWhatsAppButton from './AgentListingWhatsAppButton';
import { shareBlocker } from '@/lib/listingShareCopy';
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
 * "Marquer comme loué / vendu" opens MarkListingSoldDialog, which collects the
 * real final price (see actions.js's LISTING_STATUSES comment for why
 * 'closed' can only be reached through it).
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
 * `onStatusChange` (Mes biens) adds the active ↔ sous compromis switch here.
 * The caller keeps the optimistic update, so the badge moves the moment the
 * item is tapped.
 *
 * 2026-09-28, second pass (agents found the card cluttered, and could not
 * find how to put an under-offer listing back): the card's WhatsApp and ✓
 * "loué / vendu" icons moved IN here, so a card carries one "…" and nothing
 * else. Order: Voir l'annonce, Modifier; the status switch ("Marquer comme
 * disponible" ↔ "Marquer sous compromis") and Marquer loué / vendu; Partager
 * sur WhatsApp and Marketing & documents; Dupliquer / Archiver; Supprimer.
 * On a phone it opens as a bottom sheet with full-width rows (a dropdown
 * anchored to a 34px icon was a list of small targets); from `lg` it stays a
 * dropdown. One item list feeds both.
 */
export default function AgentListingActionsMenu({ listing, isClosed, onStatusChange, caption }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareKitOpen, setShareKitOpen] = useState(false);
  const [soldOpen, setSoldOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

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

  const isLive = listing.approve_status === 1 && !isArchived && !isClosed;
  const isRent = listing.purpose === 'rent';

  // One list, two renderers (dropdown from lg, bottom sheet below). `href`
  // items are links, `onSelect` items are actions, `whatsapp` is the share link.
  const groups = [
    [
      isLive && { key: 'view', Icon: ExternalLink, label: t('agent.listings.viewPublic'), href: `/listings/${listing.id}`, external: true },
      { key: 'edit', Icon: Pencil, label: t('agent.listings.edit'), href: `/compte/agent/biens/${listing.id}/edit` },
    ],
    [
      onStatusChange && !isClosed && listing.listing_status === 'under_offer' && {
        key: 'available', Icon: CircleCheck, tone: 'text-success', label: t('agent.listings.markActive'), onSelect: () => onStatusChange('active'),
      },
      onStatusChange && !isClosed && listing.listing_status !== 'under_offer' && {
        key: 'under-offer', Icon: CircleDot, tone: 'text-warning', label: t('agent.listings.markUnderOfferOne'), onSelect: () => onStatusChange('under_offer'),
      },
      !isClosed && {
        key: 'sold', Icon: CheckCircle2, label: isRent ? t('agent.listings.markAsLet') : t('agent.listings.markAsSold'), onSelect: () => setSoldOpen(true),
      },
    ],
    [
      !shareBlocker(listing) && { key: 'whatsapp', whatsapp: true, label: t('agent.listings.shareWhatsApp') },
      { key: 'marketing', Icon: Megaphone, label: t('agent.share.menuItem'), onSelect: () => setShareKitOpen(true) },
    ],
    [
      { key: 'duplicate', Icon: Copy, label: t('agent.listings.duplicate'), onSelect: handleDuplicate, disabled: pending },
      isClosed
        ? { key: 'relist', Icon: RotateCcw, label: t('agent.listings.relist'), onSelect: handleRepublish, disabled: pending }
        : {
            key: 'archive',
            Icon: isArchived ? ArchiveRestore : Archive,
            label: isArchived ? t('agent.listings.relistForSale') : t('agent.listings.archiveHide'),
            onSelect: handleToggleArchive,
            disabled: pending,
          },
    ],
    [{ key: 'delete', Icon: Trash2, danger: true, label: t('common.actions.delete'), onSelect: () => setConfirmDelete(true) }],
  ]
    .map((group) => group.filter(Boolean))
    .filter((group) => group.length > 0);

  const triggerClass =
    'u-press place-items-center rounded-lg text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink data-[state=open]:bg-canvas-alt data-[state=open]:text-ink';

  const sheetRow =
    'u-press flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-[0.9375rem] font-semibold text-ink hover:bg-canvas-alt disabled:opacity-50';

  return (
    <>
      {/* Phone: bottom sheet. */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-label={t('agent.listings.actionsFor', { title: listing.title })}
        aria-haspopup="dialog"
        className={`${triggerClass} grid h-10 w-10 lg:hidden`}
      >
        <MoreHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
      </button>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-card p-0 pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          <div className="border-b border-line px-4 py-3.5 pr-12">
            <SheetTitle className="u-title-card line-clamp-1 text-ink">{listing.title}</SheetTitle>
            <SheetDescription className="sr-only">{t('agent.listings.actionsFor', { title: listing.title })}</SheetDescription>
          </div>
          <div className="flex flex-col px-2 py-2">
            {groups.map((group, i) => (
              <div key={i} className={i > 0 ? 'mt-1 border-t border-line pt-1' : ''}>
                {group.map((item) => {
                  const close = () => setSheetOpen(false);
                  const tone = item.danger ? 'text-danger' : '';
                  const icon = item.Icon && (
                    <item.Icon strokeWidth={ICON_STROKE_WIDTH} className={`h-5 w-5 shrink-0 ${item.tone || (item.danger ? '' : 'text-ink-45')}`} />
                  );
                  if (item.whatsapp) {
                    return (
                      <AgentListingWhatsAppButton key={item.key} listing={listing} caption={caption} className={sheetRow} onDone={close}>
                        {item.label}
                      </AgentListingWhatsAppButton>
                    );
                  }
                  if (item.href) {
                    return (
                      <Link
                        key={item.key}
                        href={item.href}
                        onClick={close}
                        {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                        className={`${sheetRow} ${tone}`}
                      >
                        {icon}
                        {item.label}
                      </Link>
                    );
                  }
                  return (
                    <button
                      key={item.key}
                      type="button"
                      disabled={item.disabled}
                      onClick={() => {
                        close();
                        item.onSelect();
                      }}
                      className={`${sheetRow} ${tone}`}
                    >
                      {icon}
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Desktop: dropdown. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t('agent.listings.actionsFor', { title: listing.title })}
          className={`${triggerClass} hidden h-[2.125rem] w-[2.125rem] lg:grid`}
        >
          <MoreHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-[1.0625rem] w-[1.0625rem]" />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          sideOffset={6}
          collisionPadding={{ top: 12, right: 12, bottom: 24, left: 12 }}
          className="w-60 max-w-[calc(100vw-1.5rem)]"
        >
          {groups.map((group, i) => (
            <div key={i}>
              {i > 0 && <DropdownMenuSeparator />}
              {group.map((item) => {
                const icon = item.Icon && (
                  <item.Icon strokeWidth={ICON_STROKE_WIDTH} className={`h-4 w-4 ${item.tone || (item.danger ? '' : 'text-ink-45')}`} />
                );
                if (item.whatsapp) {
                  return (
                    <DropdownMenuItem key={item.key} asChild>
                      <AgentListingWhatsAppButton listing={listing} caption={caption} className="flex items-center gap-2.5">
                        {item.label}
                      </AgentListingWhatsAppButton>
                    </DropdownMenuItem>
                  );
                }
                if (item.href) {
                  return (
                    <DropdownMenuItem key={item.key} asChild>
                      <Link
                        href={item.href}
                        {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                        className="flex items-center gap-2.5"
                      >
                        {icon}
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  );
                }
                return (
                  <DropdownMenuItem
                    key={item.key}
                    onSelect={item.onSelect}
                    disabled={item.disabled}
                    className={`flex items-center gap-2.5 ${item.danger ? 'text-danger focus:text-danger' : ''}`}
                  >
                    {icon}
                    {item.label}
                  </DropdownMenuItem>
                );
              })}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {!isClosed && (
        <MarkListingSoldDialog
          propertyId={listing.id}
          purpose={listing.purpose}
          title={listing.title}
          open={soldOpen}
          onOpenChange={setSoldOpen}
        />
      )}

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
