'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Scale, MessageCircle, CalendarDays, Trash2, ImageOff } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import Price from '@/components/Price';
import { CardBadges } from '@/components/ListingBadges';
import SpecItem, { SpecCell } from '@/components/SpecItem';
import { PortalPanel, PortalSectionHeading } from '@/components/ClientPortalUI';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { listingImages, specItems, typeLabel, feedLocationLine, formatAddedOn } from '@/lib/listingView';
import { buildWhatsAppMessage, buildWhatsAppLink } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
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
 * One deliberate departure from the frozen mockup: **no "Ma note" block.**
 * The design gives every favourite a personal note ("Vérifier l'état de la
 * toiture…"). There is no note column on `customer_favorites`, so rather
 * than invent copy the slot is gone (web/CLAUDE.md's no-fabricated-data
 * rule). The status badge stays, because `listing_status` is a real column
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

function FavoriteCard({ listing, selected, disabled, onToggle, whatsappNumber, removeAction }) {
  const t = useT();
  const images = listingImages(listing);
  const cover = images[0] || null;
  const where = feedLocationLine(listing);
  const specs = specItems(listing, t);
  const type = typeLabel(listing, t);

  const contactHref = whatsappNumber
    ? buildWhatsAppLink(
        whatsappNumber,
        buildWhatsAppMessage({
          reference: listing.reference,
          slug: listing.slug,
          id: listing.id,
          propertyType: typeLabel(listing, t) || t('listings.results.subjectFallback'),
          commune: listing.commune,
          price: listing.price,
          purpose: listing.purpose,
        }),
      )
    : null;

  const visitHref = whatsappNumber
    ? buildWhatsAppLink(
        whatsappNumber,
        `Bonjour, je souhaite planifier une visite pour l'annonce Ref: ${
          listing.reference || listing.slug || `#${listing.id}`
        }. Quelles sont vos disponibilités ?`,
      )
    : null;

  return (
    <PortalPanel as="article" className="flex flex-col overflow-hidden">
      <div className="relative h-[13.125rem] shrink-0 bg-canvas-deep">
        {cover ? (
          <SafeImage
            src={cover}
            alt={listing.title}
            fill
            sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-ink-25">
            <ImageOff strokeWidth={ICON_STROKE_WIDTH} className="h-7 w-7" aria-hidden="true" />
          </span>
        )}

        <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: 'var(--scrim-image)' }} />

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

        <form action={removeAction} className="absolute right-3.5 top-3.5 z-10">
          <input type="hidden" name="propertyId" value={listing.id} />
          <button
            type="submit"
            aria-label={t('account.favorites.remove', { title: listing.title })}
            className="u-glass-white u-press inline-flex h-10 w-10 items-center justify-center rounded-full text-ink transition-colors hover:text-danger"
          >
            <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>

        <div className="pointer-events-none absolute bottom-3.5 left-3.5 z-10 flex flex-wrap gap-1.5">
          <CardBadges listing={listing} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3.5 p-5">
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
          {listing.reference ? (
            <span className="u-tabular shrink-0 text-[0.6875rem] font-normal text-ink">{listing.reference}</span>
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
          <h3 className="text-base font-medium leading-snug tracking-normal text-ink">
            <Link href={`/listings/${listing.id}`} className="transition-colors hover:text-blue-deep">
              {where || listing.title}
            </Link>
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

export default function FavoritesBoard({ listings, whatsappNumber, removeAction }) {
  const t = useT();
  const [selected, setSelected] = useState([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const selectedListings = useMemo(() => listings.filter((l) => selected.includes(l.id)), [listings, selected]);

  function toggle(id) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : current.length >= MAX_COMPARE
          ? current
          : [...current, id],
    );
  }

  const canCompare = selectedListings.length >= 2;

  return (
    <div>
      <PortalSectionHeading
        title={t('account.favorites.title')}
        lead={`${listings.length} bien${listings.length > 1 ? 's' : ''} sauvegardé${
          listings.length > 1 ? 's' : ''
        } · sélectionnez-en deux ou plus pour les comparer`}
        action={
          <button
            type="button"
            onClick={() => setCompareOpen(true)}
            disabled={!canCompare}
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[0.875rem] font-semibold transition-colors',
              canCompare ? 'u-btn-primary bg-blue text-white' : 'cursor-not-allowed bg-canvas-deep text-ink-25',
            )}
          >
            <Scale strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
            {t('account.favorites.compareCount', { count: selectedListings.length })}
          </button>
        }
        className="mb-7"
      />

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {listings.map((listing) => (
          <FavoriteCard
            key={listing.id}
            listing={listing}
            selected={selected.includes(listing.id)}
            disabled={!selected.includes(listing.id) && selected.length >= MAX_COMPARE}
            onToggle={() => toggle(listing.id)}
            whatsappNumber={whatsappNumber}
            removeAction={removeAction}
          />
        ))}
      </div>

      {selected.length >= MAX_COMPARE ? (
        <p className="mt-5 text-[0.8125rem] text-ink-45">
          Vous pouvez comparer jusqu&apos;à {MAX_COMPARE} biens à la fois.
        </p>
      ) : null}

      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t('account.favorites.compareTitle', { count: selectedListings.length })}</DialogTitle>
            <DialogDescription>
              Uniquement les informations réellement enregistrées sur chaque annonce. Un critère qu&apos;aucune des
              annonces sélectionnées ne renseigne n&apos;apparaît pas.
            </DialogDescription>
          </DialogHeader>
          {selectedListings.length > 0 ? <ComparisonTable listings={selectedListings} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
