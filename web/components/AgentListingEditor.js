'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CircleCheck, GripVertical, Plus, Sparkles, Star, X } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { convertToCdf } from '@/lib/currency';
import { convertCdfToUsd } from '@/lib/format';
import { updateListingAction } from '@/app/compte/agent/actions';
import { useToast } from './Toast';

const FIELD_CLASS =
  'u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-35';
const LABEL_CLASS = 'mb-1.5 block text-[0.8125rem] font-semibold text-ink-70';
const HINT_CLASS = 'mt-1.5 text-xs text-ink-35';

/**
 * The native listing editor — the whole point of this refactor. An agent
 * changes a price, a description, a photo order here and it is live on the
 * public storefront on save (updateListingAction revalidates every surface
 * the listing appears on). Nothing routes out to WhatsApp.
 *
 * Both of the things this editor could not honestly offer before now have
 * real columns behind them (scripts/migrate-currency-amenities-pitch.js):
 *
 *  - **$/FC toggle.** Dual-column: the agent's own figure is stored verbatim
 *    in `price_original` with its `currency`, while `price` stays canonical
 *    USD — converted at save from the same dated rate the whole site displays
 *    with. That split is what lets every `WHERE price >= / <=`, `ORDER BY
 *    price`, `MAX(price)` and the engine's budget matcher keep working
 *    untouched while an FC price is still shown to visitors exactly as it was
 *    written. The panel shows the other currency live as you type, so the
 *    agent sees both figures before saving.
 *  - **Amenity checkboxes.** Real rows in `property_amenities`, the same
 *    table that stores a listing's commune — the two never collide because
 *    communes are ids 21-44 and features are 45+, and each write path is
 *    scoped to its own range.
 *
 * Photo reorder is drag-and-drop over the real gallery. The first photo is
 * the cover (featured_image), which is what the card grids and every
 * WhatsApp share preview use — so it is labelled as such rather than left
 * as an invisible side effect of ordering.
 */
export default function AgentListingEditor({ listing, communes, cdfRate, amenities = [] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const formRef = useRef(null);

  // One list for both kinds of photo: `url` is what renders, `file` is set
  // only on a not-yet-uploaded one. Keeping them in a single ordered array
  // is what lets an agent drag a brand-new photo into the cover slot before
  // ever saving.
  const [photos, setPhotos] = useState(() =>
    (listing.gallery || []).map((url) => ({ url, file: null })),
  );
  const [photosTouched, setPhotosTouched] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  // Seeded from what the agent actually authored (price_original), not from
  // the canonical USD `price` — reopening an FC listing must show the FC
  // figure they typed, not a converted round-trip of it.
  const [currency, setCurrency] = useState(listing.currency === 'CDF' ? 'CDF' : 'USD');
  const [price, setPrice] = useState(() => {
    const authored = listing.price_original ?? listing.price;
    return authored != null ? String(authored) : '';
  });

  const [amenityIds, setAmenityIds] = useState(() => new Set(listing.amenity_ids || []));
  const [amenitiesTouched, setAmenitiesTouched] = useState(false);

  // Tracked only for the live quality hint below — the textarea itself
  // stays uncontrolled (defaultValue), so this doesn't change what actually
  // gets submitted, it just mirrors its length as the agent types.
  const [descriptionLength, setDescriptionLength] = useState((listing.description || '').length);

  function toggleAmenity(id) {
    setAmenityIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAmenitiesTouched(true);
  }

  // The *other* currency, live. Whichever one the agent is typing in is the
  // real, stored figure; this is the derived side and is labelled as such.
  const conversionPreview = useMemo(() => {
    const entered = Number.parseFloat(price);
    if (!Number.isFinite(entered) || entered <= 0) return null;
    return currency === 'CDF'
      ? { value: convertCdfToUsd(entered, cdfRate.cdfPerUsd), unit: '$' }
      : { value: convertToCdf(entered, cdfRate.cdfPerUsd), unit: 'FC' };
  }, [price, currency, cdfRate.cdfPerUsd]);

  function addPhotos(event) {
    const files = Array.from(event.target.files || []).map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    if (files.length) {
      setPhotos((prev) => [...prev, ...files]);
      setPhotosTouched(true);
    }
    event.target.value = '';
  }

  function removePhoto(index) {
    setPhotos((prev) => {
      const target = prev[index];
      // Only a locally-created object URL is ours to revoke — revoking a
      // real Supabase Storage URL would be a no-op at best.
      if (target.file) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== index);
    });
    setPhotosTouched(true);
  }

  function movePhoto(from, to) {
    if (from === to || to < 0 || to >= photos.length) return;
    setPhotos((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setPhotosTouched(true);
  }

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(formRef.current);

    // The file input's own entries are dropped and rebuilt from `photos`, so
    // the server receives them in the exact order shown on screen — a raw
    // <input multiple> submits in selection order, which is not what the
    // agent just dragged into place.
    formData.delete('photos');
    formData.delete('existing_photos');
    formData.set('photos_touched', photosTouched ? '1' : '0');
    formData.set('currency', currency);

    // Only sent when the agent actually opened the amenity section — an
    // untouched form must leave existing amenities alone, not clear them.
    formData.delete('amenities');
    formData.set('amenities_touched', amenitiesTouched ? '1' : '0');
    if (amenitiesTouched) for (const id of amenityIds) formData.append('amenities', String(id));
    for (const photo of photos) {
      if (photo.file) formData.append('photos', photo.file);
      else formData.append('existing_photos', photo.url);
    }

    startTransition(async () => {
      const result = await updateListingAction(listing.id, communes, formData);
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      showToast({
        type: result.photoWarning ? 'error' : 'success',
        message: result.photoWarning
          ? 'Modifications enregistrées, mais certaines photos n’ont pas pu être envoyées.'
          : 'Modifications enregistrées et publiées.',
      });
      setPhotosTouched(false);
      setAmenitiesTouched(false);
      router.push('/compte/agent/biens');
      router.refresh();
    });
  }

  const isRent = listing.purpose === 'rent';

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <QualityHints photoCount={photos.length} descriptionLength={descriptionLength} />

      <div className="u-card flex flex-col gap-4 rounded-card bg-surface p-6">
        <h2 className="text-[1.0625rem] font-bold text-ink">Descriptif</h2>

        <div>
          <label htmlFor="title" className={LABEL_CLASS}>Titre</label>
          <input
            id="title"
            name="title"
            required
            maxLength={150}
            defaultValue={listing.title || ''}
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label htmlFor="description" className={LABEL_CLASS}>Description</label>
          <textarea
            id="description"
            name="description"
            required
            minLength={15}
            rows={6}
            defaultValue={listing.description || ''}
            onChange={(e) => setDescriptionLength(e.target.value.length)}
            className="u-focus-ring w-full resize-y rounded-lg border border-line bg-surface p-3 text-sm leading-relaxed text-ink placeholder:text-ink-35"
          />
          <p className={HINT_CLASS}>
            Citez les équipements en toutes lettres (groupe électrogène, forage, parking, meublé…) : c’est ce texte
            que les filtres de recherche analysent.
          </p>
        </div>
      </div>

      <div className="u-card flex flex-col gap-4 rounded-card bg-surface p-6">
        <h2 className="text-[1.0625rem] font-bold text-ink">Prix et caractéristiques</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="price" className={LABEL_CLASS}>
              Prix{isRent ? ' / mois' : ''}
            </label>
            <div className="flex items-stretch gap-2">
              <input
                id="price"
                name="price"
                type="number"
                min="1"
                step={currency === 'CDF' ? '1000' : '1'}
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={`${FIELD_CLASS} u-tabular`}
              />
              {/* The toggle changes the currency the figure is *stored in*
                  (price_original + currency), not just how it's displayed —
                  switching it does not convert what's already typed, because
                  silently rewriting the agent's number would be worse than
                  making them retype it deliberately. */}
              <div
                role="group"
                aria-label="Devise du prix"
                className="flex shrink-0 items-center rounded-lg border border-line bg-canvas-alt p-0.5"
              >
                {[
                  { value: 'USD', label: '$' },
                  { value: 'CDF', label: 'FC' },
                ].map((option) => {
                  const active = currency === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setCurrency(option.value)}
                      aria-pressed={active}
                      className={`h-10 w-12 rounded-md text-[0.8125rem] font-bold transition-colors ${
                        active ? 'bg-surface text-blue-deep shadow-sm' : 'text-ink-45 hover:text-ink'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <p className={HINT_CLASS}>
              {conversionPreview?.value != null ? (
                <>
                  ≈{' '}
                  <span className="u-tabular font-semibold text-ink-45">
                    {conversionPreview.value.toLocaleString('fr-FR')} {conversionPreview.unit}
                  </span>{' '}
                  au taux du {cdfRate.updatedAt}.{' '}
                </>
              ) : null}
              {currency === 'CDF'
                ? 'Le prix est enregistré en FC tel que saisi ; l’équivalent en dollars sert au tri et aux filtres.'
                : 'Le prix est enregistré en dollars.'}
            </p>
          </div>

          <div>
            <label htmlFor="area" className={LABEL_CLASS}>Superficie (m²)</label>
            <input
              id="area"
              name="area"
              type="number"
              min="0"
              step="1"
              defaultValue={Number(listing.area) > 0 ? listing.area : ''}
              placeholder="Non précisée"
              className={FIELD_CLASS}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="beds" className={LABEL_CLASS}>Chambres</label>
            <input id="beds" name="beds" type="number" min="0" step="1" defaultValue={listing.beds ?? ''} className={FIELD_CLASS} />
          </div>
          <div>
            <label htmlFor="bath" className={LABEL_CLASS}>Salles de bain</label>
            <input id="bath" name="bath" type="number" min="0" step="1" defaultValue={listing.bath ?? ''} className={FIELD_CLASS} />
          </div>
          <div>
            <label htmlFor="units_count" className={LABEL_CLASS}>Portes</label>
            <input
              id="units_count"
              name="units_count"
              type="number"
              min="0"
              step="1"
              defaultValue={listing.units_count ?? ''}
              className={FIELD_CLASS}
            />
            <p className={HINT_CLASS}>Parcelle « Type Locataire ».</p>
          </div>
          <div>
            <label htmlFor="deposit_months" className={LABEL_CLASS}>Garantie (mois)</label>
            <input
              id="deposit_months"
              name="deposit_months"
              type="number"
              min="0"
              step="1"
              defaultValue={listing.deposit_months ?? ''}
              className={FIELD_CLASS}
            />
          </div>
        </div>
      </div>

      <div className="u-card flex flex-col gap-4 rounded-card bg-surface p-6">
        <h2 className="text-[1.0625rem] font-bold text-ink">Localisation</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="commune" className={LABEL_CLASS}>Commune</label>
            <select
              id="commune"
              name="commune"
              required
              defaultValue={communes.includes(listing.commune) ? listing.commune : ''}
              className={FIELD_CLASS}
            >
              <option value="" disabled>Choisir…</option>
              {communes.map((commune) => (
                <option key={commune} value={commune}>{commune}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="quartier" className={LABEL_CLASS}>Quartier ou référence</label>
            <input
              id="quartier"
              name="quartier"
              maxLength={120}
              defaultValue={listing.quartier || ''}
              placeholder="Ex. Rond-point Ngaba"
              className={FIELD_CLASS}
            />
          </div>
        </div>
      </div>

      {amenities.length > 0 && (
        <div className="u-card flex flex-col gap-4 rounded-card bg-surface p-6">
          <div>
            <h2 className="text-[1.0625rem] font-bold text-ink">Équipements</h2>
            <p className={HINT_CLASS}>
              Cochez ce que le bien possède réellement. Ces informations s’affichent sur l’annonce.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {amenities.map((amenity) => {
              const checked = amenityIds.has(amenity.id);
              return (
                <label
                  key={amenity.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-ink-70 transition-colors hover:bg-canvas-alt"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleAmenity(amenity.id)}
                    className="h-4 w-4 rounded-sm accent-[var(--blue)]"
                  />
                  {amenity.name}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="u-card flex flex-col gap-4 rounded-card bg-surface p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[1.0625rem] font-bold text-ink">Photos</h2>
          <span className="text-xs text-ink-35">{photos.length}/10 · glissez pour réordonner</span>
        </div>

        {photos.length === 0 ? (
          <p className="rounded-lg bg-canvas-alt px-4 py-3 text-sm text-ink-45">
            Ce bien n’a aucune photo. Ajoutez-en au moins une.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-3">
            {photos.map((photo, index) => (
              <li
                key={`${photo.url}-${index}`}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) movePhoto(dragIndex, index);
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                className={`group relative h-28 w-36 shrink-0 cursor-grab overflow-hidden rounded-lg bg-canvas-deep ${
                  dragIndex === index ? 'opacity-50' : ''
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="" className="h-full w-full object-cover" />

                {index === 0 && (
                  <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-blue px-2 py-0.5 text-[0.625rem] font-bold text-white">
                    <Star strokeWidth={2.5} className="h-2.5 w-2.5" />
                    Couverture
                  </span>
                )}

                <span
                  aria-hidden="true"
                  className="absolute bottom-1.5 left-1.5 grid h-6 w-6 place-items-center rounded-md bg-black/55 text-white"
                >
                  <GripVertical strokeWidth={2} className="h-3.5 w-3.5" />
                </span>

                {/* Keyboard-reachable equivalent of the drag handle — drag
                    and drop alone would make reordering impossible without
                    a mouse. */}
                <div className="absolute inset-x-1.5 bottom-1.5 flex justify-end gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => movePhoto(index, index - 1)}
                    disabled={index === 0}
                    aria-label="Déplacer la photo vers la gauche"
                    className="grid h-6 w-6 place-items-center rounded-md bg-black/55 text-xs font-bold text-white disabled:opacity-40"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => movePhoto(index, index + 1)}
                    disabled={index === photos.length - 1}
                    aria-label="Déplacer la photo vers la droite"
                    className="grid h-6 w-6 place-items-center rounded-md bg-black/55 text-xs font-bold text-white disabled:opacity-40"
                  >
                    →
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => removePhoto(index)}
                  aria-label="Retirer cette photo"
                  className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white"
                >
                  <X strokeWidth={2.5} className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="inline-flex h-10 w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-line px-3.5 text-[0.8125rem] font-bold text-ink-70 hover:bg-canvas-alt">
          <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          Ajouter des photos
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={addPhotos} />
        </label>
        <p className="text-xs text-ink-35">JPEG, PNG ou WebP — 5 Mo max par photo, 10 photos max.</p>
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface/95 px-1 py-4 backdrop-blur-md">
        <Link
          href="/compte/agent/biens"
          className="u-press inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold text-ink-45 hover:bg-canvas-alt hover:text-ink"
        >
          <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          Retour
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="u-btn-primary u-press h-11 rounded-lg bg-blue px-6 text-sm font-bold text-white disabled:opacity-60"
        >
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}

// Thresholds are the same ones the design's own guidance already implies
// elsewhere (10-photo cap, a description long enough to actually describe
// the place) — not invented numbers, just made visible and live instead of
// silently governing acceptance after the fact.
const MIN_RECOMMENDED_PHOTOS = 3;
const MIN_RECOMMENDED_DESCRIPTION_LENGTH = 150;

/**
 * A live prompt, not a gate — nothing here blocks saving (the form's real
 * `required`/`minLength` validation on title/description/photos still does
 * that). This only tells the agent, before they scroll past it, what would
 * make the listing show better: more photos, a fuller description. Both
 * numbers are read straight from the same state the rest of the form
 * already tracks (`photos.length`, the description textarea's live
 * length) — never a separate, possibly-stale computation.
 */
function QualityHints({ photoCount, descriptionLength }) {
  const hints = [];
  if (photoCount < MIN_RECOMMENDED_PHOTOS) {
    const remaining = MIN_RECOMMENDED_PHOTOS - photoCount;
    hints.push(
      `Ajoutez au moins ${remaining} photo${remaining > 1 ? 's' : ''} de plus pour une visibilité maximale.`,
    );
  }
  if (descriptionLength < MIN_RECOMMENDED_DESCRIPTION_LENGTH) {
    hints.push('Détaillez la description (150 caractères ou plus) pour aider les visiteurs à se projeter.');
  }

  if (hints.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-card bg-success-tint px-5 py-3.5 text-[0.8125rem] font-semibold text-success">
        <CircleCheck strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" aria-hidden="true" />
        Annonce complète — photos et description au niveau recommandé.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-card bg-warning-tint px-5 py-3.5 text-[0.8125rem] font-semibold text-warning">
      <div className="flex items-center gap-2.5">
        <Sparkles strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" aria-hidden="true" />
        Pour une meilleure visibilité
      </div>
      <ul className="ml-[1.625rem] list-disc font-normal">
        {hints.map((hint) => (
          <li key={hint}>{hint}</li>
        ))}
      </ul>
    </div>
  );
}
