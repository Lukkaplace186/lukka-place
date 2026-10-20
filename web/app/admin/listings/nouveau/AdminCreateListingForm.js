'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n/client';
import CommuneOptions from '@/components/CommuneOptions';
import AgentPicker from '../../AgentPicker';
import { adminCreateListingAction } from '../createActions';

const FIELD = 'u-focus-ring h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink';
const LABEL = 'u-eyebrow mb-1.5 block text-ink-45';

function Field({ label, span = 1, children }) {
  return (
    <label className={span === 2 ? 'sm:col-span-2' : ''}>
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

/**
 * The console's "Créer une annonce" form. Everything is re-validated by
 * adminCreateListingAction against lists it reads itself; the lists here only
 * build the form.
 */
export default function AdminCreateListingForm({ communes, categories, canPublish }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = await adminCreateListingAction(formData);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      if (!result?.ok) {
        setError(result?.error || t('errors.actionFailed'));
        return;
      }
      const notes = [];
      if (result.publishError) notes.push(`Non publiée : ${result.publishError}`);
      if (result.photoWarning) notes.push('Certaines photos n’ont pas pu être envoyées.');
      showToast({
        type: notes.length ? 'error' : 'success',
        message: [result.published ? `Annonce #${result.propertyId} créée et publiée.` : `Annonce #${result.propertyId} créée, en attente de modération.`, ...notes].join(' '),
      });
      router.push(`/admin/listings/${result.propertyId}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <section className="u-card rounded-card bg-surface p-6">
        <h2 className="u-title-card mb-4 text-ink">{t('admin.moderation.content')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Titre" span={2}>
            <input name="title" required maxLength={150} className={FIELD} />
          </Field>
          <Field label={t('listings.detail.description')} span={2}>
            <textarea
              name="description"
              required
              minLength={15}
              rows={5}
              maxLength={4000}
              className="u-focus-ring w-full resize-y rounded-lg border border-line bg-surface p-3 text-sm leading-relaxed text-ink"
            />
          </Field>
          <Field label={t('admin.moderation.propertyType')}>
            <select name="category_id" required defaultValue="" className={FIELD}>
              <option value="" disabled>—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Transaction">
            <select name="purpose" defaultValue="rent" className={FIELD}>
              <option value="rent">Location (à louer)</option>
              <option value="sale">Vente (à vendre)</option>
            </select>
          </Field>
          <Field label="Commune (ville)">
            <select name="commune" required defaultValue="" className={FIELD}>
              <option value="" disabled>—</option>
              <CommuneOptions communes={communes} />
            </select>
          </Field>
          <Field label="Quartier">
            <input name="quartier" maxLength={160} className={FIELD} />
          </Field>
          <Field label="Référence (repère ou code)" span={2}>
            <input name="reference" maxLength={120} className={FIELD} />
          </Field>
          <Field label="Chambres">
            <input name="beds" type="number" min="0" className={FIELD} />
          </Field>
          <Field label={t('admin.moderation.bathrooms')}>
            <input name="bath" type="number" min="0" className={FIELD} />
          </Field>
          <Field label="Surface (m²)">
            <input name="area" type="number" min="1" className={FIELD} />
          </Field>
        </div>
      </section>

      <section className="u-card rounded-card bg-surface p-6">
        <h2 className="u-title-card mb-4 text-ink">{t('admin.moderation.priceAndTransaction')}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('admin.moderation.displayedPrice')}>
            <input name="price" type="number" min="1" step="any" required className={FIELD} />
          </Field>
          <Field label="Devise">
            <select name="currency" defaultValue="USD" className={FIELD}>
              <option value="USD">USD</option>
              <option value="CDF">CDF (FC)</option>
            </select>
          </Field>
          <Field label={t('admin.moderation.periodicity')}>
            <select name="price_period" defaultValue="" className={FIELD}>
              <option value="">{t('admin.actions.none')}</option>
              <option value="month">Par mois</option>
              <option value="year">Par an</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="u-card rounded-card bg-surface p-6">
        <h2 className="u-title-card mb-4 text-ink">{t('admin.listings.createAgentAndPhotos')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className={LABEL}>Agent</span>
            <AgentPicker name="agent_id" allowClear placeholder={t('admin.agentPanel.chooseAgent')} />
            <p className="u-micro mt-1.5 text-ink-45">Sans agent, l’annonce affiche le numéro central de Lukka Place.</p>
          </div>
          <Field label="Photos (au moins une)">
            <input
              name="photos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              required
              className="u-micro block w-full text-ink-70 file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5"
            />
          </Field>
        </div>
        {canPublish ? (
          <label className="mt-4 flex items-start gap-2.5 rounded-lg bg-canvas-alt px-3.5 py-3">
            <input type="checkbox" name="publish_now" className="mt-0.5 h-4 w-4 rounded-sm accent-[var(--blue)]" />
            <span className="u-micro text-ink-70">{t('admin.listings.publishNow')}</span>
          </label>
        ) : null}
      </section>

      {error ? (
        <p role="alert" className="u-micro rounded-lg bg-danger/10 px-3.5 py-3 text-danger">{error}</p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="u-btn-primary u-press inline-flex h-11 items-center gap-2 rounded-lg px-5 text-sm font-bold disabled:opacity-50"
        >
          <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {pending ? '…' : t('admin.listings.create')}
        </button>
      </div>
    </form>
  );
}
