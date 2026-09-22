'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Scale, MessageCircle, CalendarDays, Trash2, ImageOff, Heart, Share2, StickyNote, Camera } from 'lucide-react';
import CardImageCarousel from '@/components/CardImageCarousel';
import Price from '@/components/Price';
import { CardBadges } from '@/components/ListingBadges';
import SpecItem, { SpecCell } from '@/components/SpecItem';
import { PortalPanel, PortalEmpty } from '@/components/ClientPortalUI';
import { useToast } from '@/components/Toast';
import { MAX_FAVORITES, MAX_FAVORITE_NOTE_LENGTH } from '@/lib/accountLimits';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { listingImages, specItems, typeLabel, feedLocationLine, formatAddedOn } from '@/lib/listingView';
import { buildWhatsAppMessage, buildWhatsAppLink } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH, SITE_URL } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/client';

/**
 * "Mes favoris" — the design's favourites board, over this app's real
 * `customer_favorites` rows.
 *
 * This is the one place in the portal that does NOT reuse
 * components/PropertyCard. The design's favourite card carries a compare
 * checkbox and a WhatsApp/visite CTA stack inside the card, and
 * PropertyCard is deliberately a single `<a>` wrapping its entire body
 * (see its own doc comment — the design removed in-card CTAs from it on
 * purpose). Nesting checkboxes, forms and links inside that anchor is
 * invalid HTML and unreachable by keyboard, so this card is built from the
 * same shared derivations (lib/listingView.js) instead of re-deriving
 * anything by hand.
 *
 * The design's "Ma note" block exists now, over a real column
 * (`customer_favorites.note`, migrations/20260918_customer_alert_preferences.sql).
 * It was left out while no column existed rather than filled with invented
 * copy; an empty note shows an "Ajouter une note" prompt, never a sample.
 * The status badge stays, because `listing_status` is a real column
 * — CardBadges renders "Sous compromis" / "Loué / Vendu" from it, and
 * nothing when the listing carries neither.
 *
 * The comparison is real too: every row is a stored field on the listing,
 * and a criterion none of the selected listings actually records is dropped
 * rather than rendered as a line of em-dashes.
 */
const MAX_COMPARE = 4;

/*
 * Built per render rather than as a module constant: both the row labels and
 * several of the derived values (specItems' unit words, the formatted date's
 * month name) depend on the active language, and a module-level array would
 * freeze all of them in whichever locale loaded first.
 */
function compareRows(t) {
  const spec = (l, key) => specItems(l, t).find((item) => item.key === key);
  return [
    { key: 'type', label: t('account.favorites.columns.type'), get: (l) => typeLabel(l, t) },
    { key: 'beds', label: t('account.favorites.columns.bedrooms'), get: (l) => spec(l, 'beds')?.value ?? null },
    { key: 'bath', label: t('account.favorites.columns.bathrooms'), get: (l) => spec(l, 'bath')?.value ?? null },
    {
      key: 'area',
      label: t('account.favorites.columns.area'),
      get: (l) => {
        const item = spec(l, 'area');
        return item ? t('listings.facts.squareMetres', { value: item.value }) : null;
      },
    },
    { key: 'units', label: t('account.favorites.columns.doors'), get: (l) => spec(l, 'units')?.value ?? null },
    { key: 'place', label: t('account.favorites.columns.location'), get: (l) => feedLocationLine(l) },
    { key: 'reference', label: t('account.favorites.columns.reference'), get: (l) => l.reference || null },
    { key: 'added', label: t('account.favorites.columns.addedOn'), get: (l) => formatAddedOn(l.created_at, t.locale) },
  ];
}

function ComparisonTable({ listings }) {
  const t = useT();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-left">
        <thead>
          <tr>
            <th scope="col" className="u-eyebrow w-36 py-3 pr-4 align-bottom">
              {t('account.favorites.criterion')}
            </th>
            {listings.map((listing) => (
              <th key={listing.id} scope="col" className="min-w-[11rem] py-3 pr-4 align-bottom">
                {/* Same 500/600 scale as the card below it — this column
                    header was 700 over 800 and stayed heavy when the cards
                    were lightened, which made the compare view read as a
                    different product from the board it opens from. */}
                <span className="block text-[0.9375rem] font-medium leading-snug text-ink">{listing.title}</span>
                <span className="u-tabular mt-1 block text-[1.0625rem] font-semibold tracking-normal text-ink">
                  <Price amount={listing.price} purpose={listing.purpose} pricePeriod={listing.price_period} />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {compareRows(t).map((row) => {
            const values = listings.map((l) => row.get(l));
            if (values.every((v) => v == null || v === '')) return null;
            return (
              <tr key={row.key} className="border-t border-line">
                <th scope="row" className="py-3 pr-4 align-top text-[0.8125rem] font-medium text-ink">
                  {row.label}
                </th>
                {values.map((value, i) => (
                  <td key={listings[i].id} className="u-tabular py-3 pr-4 align-top text-[0.875rem] font-normal text-ink">
                    {value == null || value === '' ? <span className="text-ink-25">—</span> : value}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The customer's private note on one saved listing — never shown to anyone else. */
function FavoriteNote({ listingId, initialNote, saveNoteAction }) {
  const t = useT();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState(initialNote || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialNote || '');

  if (!saveNoteAction) return null;

  function save(event) {
    event.preventDefault();
    const next = draft.trim().slice(0, MAX_FAVORITE_NOTE_LENGTH);
    startTransition(async () => {
      let result;
      try {
        result = await saveNoteAction(listingId, next);
      } catch {
        result = { ok: false };
      }
      if (!result?.ok) {
        showToast({ type: 'error', message: t('account.favorites.noteFailed') });
        return;
      }
      setNote(next);
      setEditing(false);
      showToast({ message: t('account.favorites.noteSaved') });
    });
  }

  if (editing) {
    return (
      <form onSubmit={save} className="flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={MAX_FAVORITE_NOTE_LENGTH}
          rows={3}
          autoFocus
          aria-label={t('account.favorites.note')}
          placeholder={t('account.favorites.notePlaceholder')}
          className="u-focus-ring w-full resize-y rounded-md border border-line bg-white p-2.5 text-[0.8125rem] leading-[1.5] text-ink placeholder:text-ink-35"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="u-btn-primary u-press rounded-full bg-blue px-3.5 py-1.5 text-[0.75rem] font-semibold text-white disabled:opacity-60"
          >
            {t('common.actions.save')}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(note);
              setEditing(false);
            }}
            className="u-press rounded-full px-3 py-1.5 text-[0.75rem] font-semibold text-ink-45 hover:bg-canvas-alt hover:text-ink"
          >
            {t('common.actions.cancel')}
          </button>
        </div>
      </form>
    );
  }

  if (!note) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="u-press inline-flex w-fit items-center gap-1.5 text-[0.75rem] font-semibold text-ink-45 hover:text-ink"
      >
        <StickyNote strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
        {t('account.favorites.addNote')}
      </button>
    );
  }

  return (
    <div className="rounded-md bg-canvas-alt px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="u-eyebrow">{t('account.favorites.note')}</p>
        <button
          type="button"
          onClick={() => {
            setDraft(note);
            setEditing(true);
          }}
          className="text-[0.75rem] font-semibold text-blue-deep hover:underline"
        >
          {t('account.favorites.editNote')}
        </button>
      </div>
      <p className="mt-1 whitespace-pre-line text-[0.8125rem] leading-[1.5] text-ink-70">{note}</p>
    </div>
  );
}

function FavoriteCard({ listing, selected, disabled, onToggle, whatsappNumber, onRemove, note, saveNoteAction, showCompare }) {
  const t = useT();
  const images = listingImages(listing);
  const [activeIndex, setActiveIndex] = useState(0);
  const listingHref = `/listings/${listing.id}`;
  const where = feedLocationLine(listing);
  const specs = specItems(listing, t);
  const type = typeLabel(listing, t);

  const contactHref = whatsappNumber
    ? buildWhatsAppLink(
        whatsappNumber,
        buildWhatsAppMessage({
          reference: listing.reference,
          id: listing.id,
          propertyType: typeLabel(listing, t) || t('listings.results.subjectFallback'),
          commune: listing.commune,
          price: listing.price,
          purpose: listing.purpose,
          pricePeriod: listing.price_period,
        }),
      )
    : null;

  // No slug fallback for the reference — see lib/whatsapp.js. The link names
  // the listing; a "Réf." only appears when the listing really has one.
  const visitHref = whatsappNumber
    ? buildWhatsAppLink(
        whatsappNumber,
        `Bonjour, je souhaite planifier une visite pour ce bien${
          listing.reference ? ` (Réf. ${listing.reference})` : ''
        }. Quelles sont vos disponibilités ?\n\n${SITE_URL}/listings/${listing.id}`,
      )
    : null;

  return (
    <PortalPanel as="article" className="flex flex-col overflow-hidden">
      <div className="relative h-[13.125rem] shrink-0 bg-canvas-deep">
        {/* The photo opens the listing, like every other card on the site,
            and swipes through the gallery (CardImageCarousel — the same
            strip PropertyCard uses; its arrows and dots already stop the
            tap from navigating). It was a single static cover with no link,
            so the board read as a dead end next to the feed it came from.
            The compare checkbox and the remove button sit BESIDE this link,
            not inside it: interactive controls nested in an <a> are invalid
            HTML and fire the navigation along with themselves. */}
        <Link
          href={listingHref}
          aria-label={where || listing.title}
          className="absolute inset-0 block"
        >
          {images.length > 0 ? (
            <CardImageCarousel
              images={images}
              alt={listing.title}
              sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
              onIndexChange={setActiveIndex}
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-ink-25">
              <ImageOff strokeWidth={ICON_STROKE_WIDTH} className="h-7 w-7" aria-hidden="true" />
            </span>
          )}
        </Link>

        <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: 'var(--scrim-image)' }} />

        {showCompare ? (
          <label
            className={cn(
              'u-glass-white absolute left-3.5 top-3.5 z-10 inline-flex items-center gap-2 rounded-full py-1.5 pl-2.5 pr-3 text-[0.75rem] font-bold',
              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
            )}
          >
            <input
              type="checkbox"
              checked={selected}
              disabled={disabled}
              onChange={onToggle}
              className="h-3.5 w-3.5 rounded-sm accent-[var(--blue)]"
            />
            {t('account.favorites.compare')}
          </label>
        ) : null}

        <button
          type="button"
          onClick={onRemove}
          aria-label={t('account.favorites.remove', { title: listing.title })}
          className="u-glass-white u-press absolute right-3.5 top-3.5 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full text-ink transition-colors hover:text-danger"
        >
          <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
        </button>

        <div className="pointer-events-none absolute bottom-3.5 left-3.5 z-10 flex flex-wrap gap-1.5">
          <CardBadges listing={listing} />
        </div>

        {/* Same glass counter as PropertyCard, bottom-right. */}
        {images.length > 1 ? (
          <span className="u-glass-royal u-tabular pointer-events-none absolute bottom-3.5 right-3.5 z-10 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-bold shadow-sm">
            <Camera strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
            {activeIndex + 1}/{images.length}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-3.5 p-5">
        {/* Price, place and facts are one link to the listing — the whole
            informational half of the card, not just the location words.
            The note and the CTAs below stay outside it (forms and links
            cannot nest in an <a>). */}
        <Link href={listingHref} className="group/details flex flex-col gap-3.5">
        {/* Aligned to components/PropertyCard: same 24px/800 figure, same
            inline chalk pill for the converted amount, same reference
            treatment. This card was 21px/800 with no converted figure at
            all and a 13px/400 ink-35 reference, so the two read as
            different products when a visitor moved between /listings and
            their own favourites. */}
        <div className="flex items-baseline justify-between gap-3">
          <span className="u-tabular text-2xl font-semibold leading-tight tracking-normal text-ink">
            <Price
              amount={listing.price}
              purpose={listing.purpose}
              pricePeriod={listing.price_period}
              showSubtext
              subtextClassName="ml-2 inline-block rounded-md bg-canvas-alt px-2 py-0.5 align-middle text-[0.75rem] font-medium leading-normal tracking-normal text-ink"
            />
          </span>
          {/* Same "Réf: …" treatment as components/PropertyCard — this
              card is the same product surface and already tracks that one
              deliberately (see the note above). */}
          {listing.reference ? (
            <span className="u-tabular shrink-0 text-[0.6875rem] font-normal text-ink">
              {t('listings.facts.referenceTag', { reference: listing.reference })}
            </span>
          ) : null}
        </div>

        {/* The location is the heading, matching PropertyCard and the
            listing detail page. It was `listing.title` — the agent-written
            sentence ("2 chambres — Appartement à louer à Kalamu") — with
            the real location demoted below it at 13px/400 ink-45. That is
            the exact pairing the rest of the site moved away from, and this
            card was the last public surface still carrying it. The link
            target is unchanged; only what it reads changed. */}
        <div>
          <h3 className="text-base font-medium leading-snug tracking-normal text-ink transition-colors group-hover/details:text-blue-deep">
            {where || listing.title}
          </h3>
        </div>

        {/* The labelled rail, replacing a joined "2 ch · 1 sdb" string —
            same SpecCell/SpecItem the feed card and the detail page's
            KeyFacts grid use, so all three state a listing's facts
            identically. It also gains "Type de bien", which this card never
            showed at all. */}
        {(specs.length > 0 || type) ? (
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2.5">
            {type ? (
              <SpecCell label={t('listings.facts.propertyType')}>
                <span className="truncate">{type}</span>
              </SpecCell>
            ) : null}
            {specs.map((spec) => <SpecItem key={spec.key} spec={spec} variant="stacked" />)}
          </div>
        ) : null}
        </Link>

        <FavoriteNote listingId={listing.id} initialNote={note} saveNoteAction={saveNoteAction} />

        <div className="flex-1" />

        <div className="flex flex-col gap-2.5 pt-1">
          {contactHref ? (
            <a
              href={contactHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-green px-4 py-2.5 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-green-deep"
            >
              <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
              {t('account.favorites.contactWhatsApp')}
            </a>
          ) : (
            <p className="rounded-md bg-canvas-deep px-3 py-2 text-center text-[0.75rem] text-ink-45">
              {t('account.favorites.whatsappNotConfigured')}
            </p>
          )}

          {visitHref ? (
            <a
              href={visitHref}
              target="_blank"
              rel="noopener noreferrer"
              className="u-btn-secondary inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[0.8125rem] font-semibold text-ink"
            >
              <CalendarDays strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
              {t('account.favorites.scheduleViewing')}
            </a>
          ) : null}
        </div>
      </div>
    </PortalPanel>
  );
}

/**
 * Removing a favourite is instant: the card leaves the grid on tap, the
 * server action runs behind it, and a toast offers "Annuler" for a few
 * seconds. It used to be a form post that waited for the server and then
 * re-rendered the whole portal (tab counts included) before anything moved.
 * A failed remove puts the card back and says so.
 *
 * `listings` is the server's truth and is refreshed by the action's
 * revalidatePath; `hidden` and `restoring` only bridge the moments before
 * that refresh lands, so a card never flickers back or goes missing.
 */
export default function FavoritesBoard({
  listings,
  whatsappNumber,
  removeAction,
  restoreAction,
  notes = {},
  saveNoteAction = null,
  unavailableCount = 0,
}) {
  const t = useT();
  const { showToast } = useToast();
  const [selected, setSelected] = useState([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [hidden, setHidden] = useState(() => new Set());
  // id -> { listing, index }: an undone remove, shown at its old position
  // until the refreshed `listings` includes it again.
  const [restoring, setRestoring] = useState(() => new Map());

  const visible = useMemo(() => {
    const base = listings.filter((l) => !hidden.has(l.id));
    for (const [id, { listing, index }] of restoring) {
      if (!base.some((l) => l.id === id)) base.splice(Math.min(index, base.length), 0, listing);
    }
    return base;
  }, [listings, hidden, restoring]);

  function setIn(setter, id, present, value) {
    setter((current) => {
      const next = current instanceof Map ? new Map(current) : new Set(current);
      if (present) {
        if (next instanceof Map) next.set(id, value);
        else next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function restore(listing, index) {
    setIn(setRestoring, listing.id, true, { listing, index });
    setIn(setHidden, listing.id, false);
    Promise.resolve(restoreAction ? restoreAction(listing.id) : { ok: false })
      .catch(() => ({ ok: false }))
      .then((result) => {
        if (result?.ok) return;
        setIn(setRestoring, listing.id, false);
        setIn(setHidden, listing.id, true);
        showToast({
          type: 'error',
          message: result?.reason === 'limit'
            ? t('account.limits.favorites', { max: MAX_FAVORITES })
            : t('account.favorites.restoreFailed'),
        });
      });
  }

  function remove(listing) {
    const index = visible.findIndex((l) => l.id === listing.id);
    setIn(setHidden, listing.id, true);
    setIn(setRestoring, listing.id, false);
    setSelected((current) => current.filter((id) => id !== listing.id));

    Promise.resolve(removeAction(listing.id))
      .catch(() => ({ ok: false }))
      .then((result) => {
        if (!result?.ok) {
          setIn(setHidden, listing.id, false);
          showToast({ type: 'error', message: t('account.favorites.removeFailed') });
          return;
        }
        showToast({
          message: t('account.favorites.removed'),
          action: restoreAction
            ? { label: t('account.portal.undo'), onClick: () => restore(listing, index) }
            : null,
        });
      });
  }

  const selectedListings = useMemo(() => visible.filter((l) => selected.includes(l.id)), [visible, selected]);

  /**
   * The same `/favoris?ids=` link the public favourites page shares — anyone
   * can open it, no account needed — so a customer can send their shortlist to
   * family on WhatsApp. The phone's own share sheet when there is one; the
   * clipboard otherwise, and only claims "copied" when the copy worked.
   */
  async function shareSelection() {
    const url = `${SITE_URL}/favoris?ids=${visible.map((l) => l.id).join(',')}`;
    const text = t('account.favorites.shareMessage', { url });
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ text });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast({ message: t('account.favorites.linkCopied') });
    } catch {
      // Clipboard refused (permission, insecure context): say nothing false.
    }
  }

  if (visible.length === 0) {
    return (
      <PortalEmpty
        icon={Heart}
        title={t('account.favorites.emptyTitle')}
        actionLabel={t('account.favorites.browseListings')}
        actionHref="/listings"
      >
        {t('account.favorites.emptyBody')}
      </PortalEmpty>
    );
  }

  function toggle(id) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : current.length >= MAX_COMPARE
          ? current
          : [...current, id],
    );
  }

  const canOfferCompare = visible.length >= 2;
  const canCompare = selectedListings.length >= 2;

  return (
    <div>
      {/* No heading here: the portal tab and the "Favoris (N)" pill above
          already say what this is and how many. The old h2 + count sentence
          were the third and fourth labels before the first photo on a
          phone. Compare only appears once there are two listings to
          compare — a greyed "Comparer (0)" on a one-favourite board is a
          control that can never be used. */}
      <div className="mb-5 flex items-center justify-between gap-3 sm:mb-7">
        <p className="text-[0.8125rem] leading-[1.5] text-ink-45">
          {canOfferCompare
            ? t('account.favorites.compareHint')
            : t('account.favorites.savedCountShort', { count: visible.length })}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={shareSelection}
            aria-label={t('account.favorites.shareSelection')}
            title={t('account.favorites.shareSelection')}
            className="u-btn-secondary u-press inline-flex h-10 items-center justify-center gap-2 rounded-full px-3 text-[0.875rem] font-semibold text-ink sm:px-5"
          >
            <Share2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t('account.favorites.shareSelection')}</span>
          </button>
          {canOfferCompare ? (
            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              disabled={!canCompare}
              className={cn(
                'inline-flex h-10 items-center gap-2 rounded-full px-4 text-[0.875rem] font-semibold transition-colors sm:px-5',
                canCompare ? 'u-btn-primary bg-blue text-white' : 'cursor-not-allowed bg-canvas-deep text-ink-35',
              )}
            >
              <Scale strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
              {t('account.favorites.compareCount', { count: selectedListings.length })}
            </button>
          ) : null}
        </div>
      </div>

      {unavailableCount > 0 ? (
        <p role="status" className="mb-5 rounded-md bg-canvas-deep px-4 py-3 text-[0.8125rem] text-ink-70">
          {t('account.favorites.unavailable', { count: unavailableCount })}
        </p>
      ) : null}

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((listing) => (
          <FavoriteCard
            key={listing.id}
            listing={listing}
            selected={selected.includes(listing.id)}
            disabled={!selected.includes(listing.id) && selected.length >= MAX_COMPARE}
            onToggle={() => toggle(listing.id)}
            whatsappNumber={whatsappNumber}
            onRemove={() => remove(listing)}
            showCompare={canOfferCompare}
            note={notes[String(listing.id)] || ''}
            saveNoteAction={saveNoteAction}
          />
        ))}
      </div>

      {selected.length >= MAX_COMPARE ? (
        <p className="mt-5 text-[0.8125rem] text-ink-45">
          {t('account.favorites.compareMax', { max: MAX_COMPARE })}
        </p>
      ) : null}

      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t('account.favorites.compareTitle', { count: selectedListings.length })}</DialogTitle>
            <DialogDescription>{t('account.favorites.compareNote')}</DialogDescription>
          </DialogHeader>
          {selectedListings.length > 0 ? <ComparisonTable listings={selectedListings} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
