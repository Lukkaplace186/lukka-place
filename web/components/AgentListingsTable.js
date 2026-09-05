'use client';

import { useMemo, useOptimistic, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Archive, ArchiveRestore, ExternalLink, Image as ImageIcon, Trash2 } from 'lucide-react';
import SafeImage from './SafeImage';
import AgentListingStatusSelect from './AgentListingStatusSelect';
import AgentListingActionsMenu from './AgentListingActionsMenu';
import MarkListingSoldDialog from './MarkListingSoldDialog';
import { formatPrice, formatPriceCdf } from '@/lib/format';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { usableImageSrc } from '@/lib/listingView';
import {
  updateListingStatusAction,
  updateListingPriceAction,
  bulkMarkUnderOfferAction,
  bulkSetArchivedAction,
  bulkDeleteListingsAction,
} from '@/app/compte/agent/actions';
import { useToast } from './Toast';

const LISTING_STATUS_EDIT_OPTIONS = [
  { value: 'active', label: 'Actif' },
  { value: 'under_offer', label: 'Sous compromis' },
];

const APPROVE_STATUS = {
  0: { label: 'En attente', className: 'bg-warning-tint text-warning' },
  1: { label: 'Publié', className: 'bg-success-tint text-success' },
  2: { label: 'Rejeté', className: 'bg-danger-tint text-danger' },
};

// An archived listing (properties.status = 0) is invisible to the public
// regardless of its moderation state, so showing it as "Publié" would be a
// straightforward lie about where it is. This badge replaces the
// approve-status one rather than sitting beside it.
const ARCHIVED_BADGE = { label: 'Archivée', className: 'bg-canvas-deep text-ink-45' };

function shortDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

// Written out as a full literal (not composed or .replace()-d at runtime):
// Tailwind scans source text, so an arbitrary-value class it never sees
// spelled out simply doesn't get generated (see web/CLAUDE.md). One extra
// column versus the previous grid — a checkbox — for bulk selection.
const GRID_COLS =
  'lg:grid-cols-[2.25rem_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,1.2fr)_minmax(0,0.6fr)]';

/**
 * The Mes biens row list — a client component (unlike the surrounding
 * server-rendered page) because bulk selection, inline price editing and
 * optimistic status changes are all genuinely per-visit UI state that has
 * no business living in a URL or a database round trip.
 *
 * Three things worth knowing about the choices made here:
 *
 *  - **No bulk "Marquer comme loué / vendu".** That status can only be
 *    reached with a real final sale price (markListingSoldAction) — there is
 *    no honest single price to apply across a batch of different listings.
 *    The bulk bar offers "Marquer sous compromis" instead, which carries no
 *    such requirement. See actions.js's bulkMarkUnderOfferAction doc
 *    comment for the same reasoning at the server boundary.
 *  - **Optimistic updates via `useOptimistic`.** A status change or a saved
 *    price appears instantly; the real server action still runs underneath
 *    and `router.refresh()` reconciles the list with what actually got
 *    written. A failure reverts (React re-renders from the last committed
 *    `listings` prop) and shows a toast — it never leaves the row silently
 *    lying about its own state.
 *  - **The listing title links to the public detail page** (`/listings/id`,
 *    new tab) — the actual live route (there is no `/biens/id` on the
 *    public site). Editing still lives behind the row's own actions menu,
 *    so the title's click target is unambiguous: "see it live", not "edit
 *    it".
 */
export default function AgentListingsTable({ listings, perListingStats }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(() => new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const [optimisticListings, applyOptimistic] = useOptimistic(listings, (state, patch) => {
    if (patch.type === 'update') {
      return state.map((l) => (l.id === patch.id ? { ...l, ...patch.changes } : l));
    }
    if (patch.type === 'remove') {
      const ids = new Set(patch.ids);
      return state.filter((l) => !ids.has(l.id));
    }
    return state;
  });

  const selectableIds = useMemo(
    () => optimisticListings.filter((l) => l.listing_status !== 'closed').map((l) => l.id),
    [optimisticListings],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  // Drives whether the bulk bar offers Archiver or Remettre en ligne. Only
  // flips to "restore" when EVERY selected row is already archived — a mixed
  // selection archives, which is the non-destructive read of an ambiguous
  // intent (nothing leaves the public site by surprise on the way back).
  const allSelectedArchived = useMemo(() => {
    if (selected.size === 0) return false;
    return optimisticListings
      .filter((l) => selected.has(l.id))
      .every((l) => Number(l.status) === 0);
  }, [optimisticListings, selected]);

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (allSelected ? new Set() : new Set(selectableIds)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function handleStatusChange(listing, status) {
    startTransition(async () => {
      applyOptimistic({ type: 'update', id: listing.id, changes: { listing_status: status, sold_price: null } });
      try {
        const formData = new FormData();
        formData.set('listing_status', status);
        await updateListingStatusAction(listing.id, formData);
        router.refresh();
      } catch (err) {
        showToast({ type: 'error', message: err.message || 'Échec de la mise à jour du statut.' });
        router.refresh();
      }
    });
  }

  function handlePriceSave(listing, rawValue) {
    const value = Number.parseFloat(rawValue);
    if (!Number.isFinite(value) || value <= 0) {
      showToast({ type: 'error', message: 'Indiquez un prix valide.' });
      return;
    }
    startTransition(async () => {
      // The row displays price_original in the listing's own currency (see
      // PriceCell below), so patching that field optimistically is enough
      // for a USD listing — the display and the write are the same number.
      // For an FC listing the real canonical `price` (USD) also changes
      // server-side (converted at the current dated rate), but that
      // conversion needs the live admin-editable rate this client component
      // doesn't hold; the display isn't affected in the meantime since it
      // reads price_original, not price, and router.refresh() below picks
      // up the real converted figure once the write completes.
      applyOptimistic({ type: 'update', id: listing.id, changes: { price_original: value } });
      const formData = new FormData();
      formData.set('price', String(value));
      formData.set('currency', listing.currency || 'USD');
      const result = await updateListingPriceAction(listing.id, formData);
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
      }
      router.refresh();
    });
  }

  function handleBulkUnderOffer() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkPending(true);
    startTransition(async () => {
      // useOptimistic's reducer patches one id per dispatch — applied once
      // per selected row, all synchronously before the first `await` below,
      // so React batches them into one optimistic render.
      for (const id of ids) {
        applyOptimistic({ type: 'update', id, changes: { listing_status: 'under_offer', sold_price: null } });
      }
      try {
        const result = await bulkMarkUnderOfferAction(ids);
        showToast({
          type: 'success',
          message: `${result.updated} bien${result.updated === 1 ? '' : 's'} marqué${result.updated === 1 ? '' : 's'} sous compromis.`,
        });
      } catch (err) {
        showToast({ type: 'error', message: err.message || 'Échec de la mise à jour groupée.' });
      }
      clearSelection();
      setBulkPending(false);
      router.refresh();
    });
  }

  function handleBulkArchive(archived) {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkPending(true);
    startTransition(async () => {
      for (const id of ids) {
        applyOptimistic({ type: 'update', id, changes: { status: archived ? 0 : 1 } });
      }
      try {
        const result = await bulkSetArchivedAction(ids, archived);
        showToast({
          type: 'success',
          message: archived
            ? `${result.updated} bien${result.updated === 1 ? '' : 's'} archivé${result.updated === 1 ? '' : 's'} — masqué${result.updated === 1 ? '' : 's'} du site, rien n’est supprimé.`
            : `${result.updated} bien${result.updated === 1 ? '' : 's'} remis en ligne.`,
        });
      } catch (err) {
        showToast({ type: 'error', message: err.message || 'Échec de la mise à jour groupée.' });
      }
      clearSelection();
      setBulkPending(false);
      router.refresh();
    });
  }

  function handleBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkPending(true);
    startTransition(async () => {
      applyOptimistic({ type: 'remove', ids });
      try {
        const result = await bulkDeleteListingsAction(ids);
        showToast({
          type: result.failed > 0 ? 'error' : 'success',
          message:
            result.failed > 0
              ? `${result.deleted} bien${result.deleted === 1 ? '' : 's'} supprimé${result.deleted === 1 ? '' : 's'}, ${result.failed} échec${result.failed === 1 ? '' : 's'}.`
              : `${result.deleted} bien${result.deleted === 1 ? '' : 's'} supprimé${result.deleted === 1 ? '' : 's'}.`,
        });
      } catch (err) {
        showToast({ type: 'error', message: err.message || 'Échec de la suppression groupée.' });
      }
      clearSelection();
      setConfirmBulkDelete(false);
      setBulkPending(false);
      router.refresh();
    });
  }

  return (
    <>
      <div
        // lg:gap-3 must match the data rows below exactly — without it the
        // header's columns are each slightly wider than the rows spend on
        // gaps, so every column label sits off its own column.
        className={`hidden ${GRID_COLS} items-center bg-canvas-alt px-6 py-3 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-35 lg:grid lg:gap-3`}
      >
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleAll}
          aria-label="Tout sélectionner"
          disabled={selectableIds.length === 0}
          className="h-4 w-4 rounded-sm accent-[var(--blue)]"
        />
        <div>Bien</div>
        <div>Prix</div>
        <div>Vues</div>
        <div>Clics</div>
        <div>Statut</div>
        <div className="text-right">Actions</div>
      </div>

      {optimisticListings.map((listing) => {
        const isClosed = listing.listing_status === 'closed';
        const isArchived = Number(listing.status) === 0;
        // A closed listing is archived too (markListingSoldAction retires it
        // from public search), but "Loué / Vendu" already says that in the
        // status column — a second "Archivée" chip beside it is noise.
        const approve = isArchived && !isClosed ? ARCHIVED_BADGE : APPROVE_STATUS[listing.approve_status];
        const isSelected = selected.has(listing.id);

        return (
          <div
            key={listing.id}
            className={`flex flex-wrap items-center gap-4 border-t border-line px-6 py-4 lg:grid ${GRID_COLS} lg:gap-3`}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleOne(listing.id)}
              disabled={isClosed}
              aria-label={`Sélectionner ${listing.title}`}
              className="h-4 w-4 shrink-0 rounded-sm accent-[var(--blue)] disabled:opacity-30"
            />

            <div className="flex min-w-0 flex-1 items-center gap-3.5 lg:flex-none">
              <div className="grid h-12 w-16 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-canvas-deep text-ink-25">
                {usableImageSrc(listing.featured_image) ? (
                  <SafeImage
                    src={listing.featured_image}
                    alt=""
                    width={64}
                    height={48}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageIcon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
                )}
              </div>
              <div className="min-w-0">
                {listing.approve_status === 1 ? (
                  <Link
                    href={`/listings/${listing.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex max-w-full items-center gap-1 truncate text-sm font-bold text-ink hover:text-blue-deep hover:underline"
                    title="Voir l’annonce publique"
                  >
                    <span className="truncate">{listing.title}</span>
                    <ExternalLink
                      strokeWidth={ICON_STROKE_WIDTH}
                      aria-hidden="true"
                      className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </Link>
                ) : (
                  <div className="truncate text-sm font-bold text-ink" title="Annonce pas encore publiée">
                    {listing.title}
                  </div>
                )}
                <div className="mt-[3px] flex items-center gap-2 text-xs text-ink-45">
                  <span className="truncate">{listing.quartier || 'Localisation non précisée'}</span>
                  {approve && (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.625rem] font-bold ${approve.className}`}>
                      {approve.label}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <PriceCell listing={listing} isClosed={isClosed} onSave={(value) => handlePriceSave(listing, value)} />

            <div className="u-tabular text-sm text-ink-70">
              <span className="lg:hidden">Vues : </span>
              {(perListingStats.views[listing.id] || 0).toLocaleString('fr-FR')}
            </div>

            <div className="u-tabular text-sm text-ink-70">
              <span className="lg:hidden">Clics WhatsApp : </span>
              {(perListingStats.clicks[listing.id] || 0).toLocaleString('fr-FR')}
            </div>

            {isClosed ? (
              <span className="w-full max-w-[10.5rem] rounded-full bg-canvas-deep px-3.5 py-[0.4375rem] text-center text-[0.8125rem] font-bold text-ink-70">
                {listing.purpose === 'rent' ? 'Loué' : 'Vendu'}
              </span>
            ) : (
              // Keyed on the optimistic status itself: AgentListingStatusSelect
              // is an uncontrolled <select defaultValue=…>, which only applies
              // on mount — without a key tied to the value, an optimistic
              // status change would recolour the pill (a plain className) but
              // leave the native <select>'s own selected option stale until
              // the next full remount.
              <AgentListingStatusSelect
                key={listing.listing_status}
                name="listing_status"
                defaultValue={listing.listing_status}
                options={LISTING_STATUS_EDIT_OPTIONS}
                label={`Statut de ${listing.title}`}
                onChange={(status) => handleStatusChange(listing, status)}
              />
            )}

            <div className="flex items-center justify-end gap-1.5">
              {!isClosed && (
                <MarkListingSoldDialog propertyId={listing.id} purpose={listing.purpose} title={listing.title} />
              )}
              <AgentListingActionsMenu listing={listing} isClosed={isClosed} />
            </div>
          </div>
        );
      })}

      {selected.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4 lg:bottom-8 lg:pl-[260px]">
          <div className="u-lift pointer-events-auto flex flex-wrap items-center gap-3 rounded-full bg-ink px-5 py-3 text-white">
            <span className="u-tabular text-[0.8125rem] font-bold">
              {selected.size} sélectionné{selected.size === 1 ? '' : 's'}
            </span>
            <span className="h-4 w-px bg-white/25" aria-hidden="true" />
            <button
              type="button"
              onClick={handleBulkUnderOffer}
              disabled={pending || bulkPending}
              className="u-press rounded-full bg-white/15 px-3.5 py-1.5 text-[0.8125rem] font-bold text-white transition-colors hover:bg-white/25 disabled:opacity-50"
            >
              Marquer sous compromis
            </button>
            <button
              type="button"
              onClick={() => handleBulkArchive(!allSelectedArchived)}
              disabled={pending || bulkPending}
              className="u-press inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-[0.8125rem] font-bold text-white transition-colors hover:bg-white/25 disabled:opacity-50"
            >
              {allSelectedArchived ? (
                <ArchiveRestore strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
              ) : (
                <Archive strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
              )}
              {allSelectedArchived ? 'Remettre en ligne' : 'Archiver'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmBulkDelete(true)}
              disabled={pending || bulkPending}
              className="u-press inline-flex items-center gap-1.5 rounded-full bg-danger/90 px-3.5 py-1.5 text-[0.8125rem] font-bold text-white transition-colors hover:bg-danger disabled:opacity-50"
            >
              <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
              Supprimer
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="u-press rounded-full px-3 py-1.5 text-[0.8125rem] font-semibold text-white/70 hover:text-white"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {confirmBulkDelete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
        >
          <div className="u-card w-full max-w-sm rounded-card bg-surface p-6">
            <h2 className="u-title-card text-ink">Supprimer {selected.size} bien{selected.size === 1 ? '' : 's'} ?</h2>
            <p className="mt-2 text-sm text-ink-45">
              Ces annonces et leurs photos seront définitivement retirées du site. Cette action est irréversible.
            </p>
            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmBulkDelete(false)}
                className="u-press inline-flex h-11 items-center rounded-lg px-4 text-sm font-semibold text-ink-45 hover:bg-canvas-alt hover:text-ink"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={bulkPending}
                className="u-press h-11 rounded-lg bg-danger px-5 text-sm font-bold text-white disabled:opacity-60"
              >
                {bulkPending ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Click-to-edit price cell — displays and edits the listing's own authored
 * figure (price_original, in its real currency), the same figure the public
 * <Price> component and the full native editor treat as the exact one.
 * Stays in that same currency on edit (a switch between USD and FC is a
 * bigger decision than a quick inline edit should make — that stays in the
 * full editor, which shows both figures and explains the conversion).
 * Enter/blur saves, Escape cancels.
 */
function PriceCell({ listing, isClosed, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  const isCdf = listing.currency === 'CDF';
  const authored = listing.price_original ?? listing.price;
  const currencyLabel = isCdf ? 'FC' : '$';

  function startEdit() {
    if (isClosed) return;
    setValue(authored != null ? String(authored) : '');
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    if (value === '' || Number(value) === Number(authored)) return;
    onSave(value);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          min="1"
          step="1"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="u-focus-ring u-tabular h-9 w-24 rounded-md border border-line bg-surface px-2 text-sm font-bold text-ink"
        />
        <span className="text-xs font-semibold text-ink-45">{currencyLabel}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      disabled={isClosed}
      title={isClosed ? undefined : 'Modifier le prix'}
      className={`u-tabular rounded-md px-1.5 py-0.5 text-left text-sm font-bold text-ink ${
        isClosed ? 'cursor-default' : 'cursor-text hover:bg-canvas-alt'
      }`}
    >
      {isCdf ? formatPriceCdf(authored, listing.purpose) : formatPrice(authored, listing.purpose)}
      {isClosed && listing.sold_price != null && (
        <div className="mt-0.5 text-xs font-semibold text-ink-45">
          {/* sold_price is always written in USD (markListingSoldAction has
              no currency field), unlike the listing's own authored price
              above — so this one line intentionally never uses formatPriceCdf. */}
          Prix final : {formatPrice(listing.sold_price, listing.purpose)}
          {shortDate(listing.sold_at) ? ` · ${shortDate(listing.sold_at)}` : ''}
        </div>
      )}
    </button>
  );
}
