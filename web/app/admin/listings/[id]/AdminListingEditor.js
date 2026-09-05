'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Save } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useToast } from '@/components/Toast';
import { adminUpdateListingAction, adminSetListingVisibleAction } from './actions';

const FIELD =
  'u-focus-ring h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink';
const LABEL = 'u-eyebrow mb-1.5 block text-ink-45';

function Field({ label, children, span = 1 }) {
  return (
    <div className={span === 2 ? 'sm:col-span-2' : span === 3 ? 'sm:col-span-3' : ''}>
      <span className={LABEL}>{label}</span>
      {children}
    </div>
  );
}

/**
 * The admin override editor.
 *
 * Every field here writes the same column the agent's own editor writes —
 * this is not a parallel "admin copy" of a listing, it is the listing. What
 * differs is authority: no `agent_id` scoping (an admin reaches any listing,
 * including the many with no agent attached), and three fields an agent
 * cannot touch at all:
 *
 *   listing_status + sold_price + sold_at   correcting a mistyped
 *       transaction, which matters because the market export is a commercial
 *       product sold on its accuracy
 *   latitude / longitude                    fixing a pin by hand, for the
 *       listings whose address geocodes to the wrong place
 *
 * Blank means NULL, not "unchanged" — the server action turns an empty
 * string into a real null so a moderator can genuinely clear a wrong value,
 * which is the single most common thing they need to do and was impossible
 * before this page existed.
 */
export default function AdminListingEditor({ listing, communes, categories }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(listing.listing_status || 'active');

  const isVisible = Number(listing.status) === 1;
  const categoryIds = categories.map((c) => c.id);

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await adminUpdateListingAction(listing.id, communes, categoryIds, formData);
      showToast(
        result.ok
          ? { type: 'success', message: 'Annonce mise à jour.' }
          : { type: 'error', message: result.error },
      );
      if (result.ok) router.refresh();
    });
  }

  function toggleVisibility() {
    startTransition(async () => {
      const result = await adminSetListingVisibleAction(listing.id, !isVisible);
      showToast(
        result.ok
          ? {
              type: 'success',
              message: isVisible
                ? 'Annonce suspendue — retirée du site public.'
                : 'Annonce remise en ligne.',
            }
          : { type: 'error', message: result.error },
      );
      if (result.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <section className="u-card rounded-card bg-surface p-6">
        <h2 className="u-title-card mb-4 text-ink">Contenu</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Titre" span={2}>
            <input name="title" defaultValue={listing.title || ''} maxLength={150} className={FIELD} />
          </Field>
          <Field label="Description" span={2}>
            <textarea
              name="description"
              defaultValue={listing.description || ''}
              rows={5}
              maxLength={4000}
              className="u-focus-ring w-full resize-y rounded-lg border border-line bg-surface p-3 text-sm leading-relaxed text-ink"
            />
          </Field>
        </div>
      </section>

      <section className="u-card rounded-card bg-surface p-6">
        <h2 className="u-title-card mb-4 text-ink">Localisation</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Commune">
            <select name="commune" defaultValue={listing.commune || ''} className={FIELD}>
              <option value="">— Aucune —</option>
              {communes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quartier">
            <input name="quartier" defaultValue={listing.quartier || ''} className={FIELD} />
          </Field>
          <Field label="Référence">
            <input name="reference" defaultValue={listing.reference || ''} className={FIELD} />
          </Field>
          <Field label="Latitude">
            <input
              name="latitude"
              defaultValue={listing.latitude || ''}
              placeholder="-4.3276"
              className={FIELD}
            />
          </Field>
          <Field label="Longitude">
            <input
              name="longitude"
              defaultValue={listing.longitude || ''}
              placeholder="15.3136"
              className={FIELD}
            />
          </Field>
          <div className="flex items-end">
            <p className="u-micro text-ink-45">
              Laissez vides pour utiliser le géocodage automatique (adresse, puis centroïde de la commune).
            </p>
          </div>
        </div>
      </section>

      <section className="u-card rounded-card bg-surface p-6">
        <h2 className="u-title-card mb-4 text-ink">Caractéristiques</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type de bien">
            <select name="category_id" defaultValue={listing.category_id ?? ''} className={FIELD}>
              <option value="">— Aucun —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Transaction">
            <select name="purpose" defaultValue={listing.purpose || 'rent'} className={FIELD}>
              <option value="rent">Location</option>
              <option value="sale">Vente</option>
            </select>
          </Field>
          <Field label="Sous-type (parcelle)">
            <input name="parcelle_subtype" defaultValue={listing.parcelle_subtype || ''} className={FIELD} />
          </Field>

          <Field label="Chambres">
            <input name="beds" type="number" min="0" defaultValue={listing.beds ?? ''} className={FIELD} />
          </Field>
          <Field label="Salles de bain">
            <input name="bath" type="number" min="0" defaultValue={listing.bath ?? ''} className={FIELD} />
          </Field>
          <Field label="Surface (m²)">
            <input
              name="area"
              type="number"
              min="0"
              // '0' is this column's stored "unknown" — shown as blank so a
              // moderator never reads it as a real measurement, and cleared
              // back to NULL on save.
              defaultValue={listing.area && listing.area !== '0' ? listing.area : ''}
              className={FIELD}
            />
          </Field>
          <Field label="Portes (Type Locataire)">
            <input
              name="units_count"
              type="number"
              min="0"
              defaultValue={listing.units_count ?? ''}
              className={FIELD}
            />
          </Field>
          <Field label="Caution (mois)">
            <input
              name="deposit_months"
              type="number"
              min="0"
              defaultValue={listing.deposit_months ?? ''}
              className={FIELD}
            />
          </Field>
        </div>
      </section>

      <section className="u-card rounded-card bg-surface p-6">
        <h2 className="u-title-card mb-4 text-ink">Prix et transaction</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Prix affiché (USD)">
            <input
              name="price"
              type="number"
              min="0"
              step="0.01"
              defaultValue={listing.price ?? ''}
              className={FIELD}
            />
          </Field>
          <Field label="Prix saisi par l’agent">
            <input
              name="price_original"
              type="number"
              min="0"
              step="0.01"
              defaultValue={listing.price_original ?? ''}
              className={FIELD}
            />
          </Field>
          <Field label="Devise saisie">
            <select name="currency" defaultValue={listing.currency || 'USD'} className={FIELD}>
              <option value="USD">USD</option>
              <option value="CDF">CDF (FC)</option>
            </select>
          </Field>
          <Field label="Périodicité">
            <select name="price_period" defaultValue={listing.price_period || ''} className={FIELD}>
              <option value="">— Aucune —</option>
              <option value="month">Par mois</option>
              <option value="year">Par an</option>
              <option value="day">Par jour</option>
            </select>
          </Field>
          <Field label="Statut du marché">
            <select
              name="listing_status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={FIELD}
            >
              <option value="active">Actif</option>
              <option value="under_offer">Sous compromis</option>
              <option value="closed">Loué / Vendu</option>
            </select>
          </Field>
        </div>

        {status === 'closed' && (
          <div className="mt-4 grid gap-4 rounded-lg bg-canvas-alt p-4 sm:grid-cols-3">
            <Field label="Prix final convenu (USD)">
              <input
                name="sold_price"
                type="number"
                min="0"
                step="0.01"
                defaultValue={listing.sold_price ?? ''}
                className={FIELD}
              />
            </Field>
            <Field label="Date de la transaction">
              <input
                name="sold_at"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                defaultValue={listing.sold_at ? String(listing.sold_at).slice(0, 10) : ''}
                className={FIELD}
              />
            </Field>
            <div className="flex items-end">
              <p className="u-micro text-ink-45">
                Ces deux valeurs alimentent l’export de données de marché (prix demandé vs prix obtenu,
                délai de vente). Elles ne sont jamais publiées sur l’annonce.
              </p>
            </div>
          </div>
        )}
      </section>

      <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-card bg-ink px-5 py-3.5">
        <button
          type="submit"
          disabled={pending}
          className="u-press inline-flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-[0.8125rem] font-bold text-ink disabled:opacity-60"
        >
          <Save strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {pending ? 'Enregistrement…' : 'Enregistrer les modifications'}
        </button>

        <button
          type="button"
          onClick={toggleVisibility}
          disabled={pending}
          className="u-press inline-flex h-10 items-center gap-2 rounded-lg bg-white/15 px-4 text-[0.8125rem] font-bold text-white transition-colors hover:bg-white/25 disabled:opacity-60"
        >
          {isVisible ? (
            <EyeOff strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          ) : (
            <Eye strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          )}
          {isVisible ? 'Suspendre (retirer du site)' : 'Remettre en ligne'}
        </button>

        <span className="u-micro ml-auto text-white/60">
          {isVisible ? 'Visible sur lukkaplace.com' : 'Masquée du site public'}
        </span>
      </div>
    </form>
  );
}
