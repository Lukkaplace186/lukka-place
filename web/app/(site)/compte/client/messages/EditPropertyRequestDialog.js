'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n/client';

const FIELD_CLASS =
  'u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-35';
const LABEL_CLASS = 'mb-1.5 block text-[0.8125rem] font-semibold text-ink-70';

const BEDROOM_OPTIONS = ['1', '2', '3', '4'];

/**
 * "Modifier ma recherche" — lets a customer correct/refine the structured
 * fields on their own lead (commune, transaction, budget, bedrooms, raw
 * notes) after submission, instead of the request being frozen the moment
 * it's sent. Same imperative-action + {ok,error}-result + toast pattern as
 * MarkListingSoldDialog/CreateListingDialog: stays open on a validation
 * failure, closes and refreshes the server data on success.
 *
 * Commune options are the same real, never-hardcoded list every other
 * commune select in this app uses (web/CLAUDE.md); only a single commune is
 * editable here because `leads.commune` is a single TEXT column, same
 * constraint actions.js's submitPropertyRequestAction already documents.
 */
export default function EditPropertyRequestDialog({
  leadId,
  action,
  communes,
  transactionType: initialTransactionType,
  commune: initialCommune,
  priceMin: initialPriceMin,
  priceMax: initialPriceMax,
  bedrooms: initialBedrooms,
  requirementsSummary: initialRequirementsSummary,
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [transactionTypeValue, setTransactionTypeValue] = useState(initialTransactionType || 'location');
  const router = useRouter();
  const { showToast } = useToast();

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await action(leadId, formData);
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      showToast({
        type: 'success',
        message: result.proposalsReset
          ? t('account.requestForm.updatedWithReset')
          : t('account.requestForm.updated'),
      });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="u-press inline-flex items-center gap-2 rounded-full px-4 py-2 text-[0.8125rem] font-semibold text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink"
      >
        <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
        {t('account.requestForm.editTitle')}
      </button>

      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('account.requestForm.editTitle')}</DialogTitle>
          <DialogDescription>
            {t('account.requestForm.editLead')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input type="hidden" name="transactionType" value={transactionTypeValue} />

          <div>
            <span className={LABEL_CLASS}>{t('account.requestForm.transactionTypeLabel')}</span>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { value: 'vente', label: 'Acheter' },
                { value: 'location', label: 'Louer' },
              ].map(({ value, label }) => {
                const active = transactionTypeValue === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTransactionTypeValue(value)}
                    aria-pressed={active}
                    className={
                      active
                        ? 'rounded-lg bg-blue-tint px-4 py-2.5 text-sm font-bold text-blue-deep shadow-[inset_0_0_0_1.5px_var(--blue)]'
                        : 'rounded-lg bg-surface px-4 py-2.5 text-sm font-semibold text-ink-70 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-canvas-alt'
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="edit_commune" className={LABEL_CLASS}>Commune</label>
              <select
                id="edit_commune"
                name="commune"
                required
                defaultValue={initialCommune || ''}
                className={FIELD_CLASS}
              >
                <option value="" disabled>Choisir…</option>
                {communes.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="edit_bedrooms" className={LABEL_CLASS}>Chambres</label>
              <select
                id="edit_bedrooms"
                name="bedrooms"
                defaultValue={initialBedrooms != null ? String(initialBedrooms) : ''}
                className={FIELD_CLASS}
              >
                <option value="">{t('account.requestForm.noPreference')}</option>
                {BEDROOM_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value === '4' ? '4 et plus' : value}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="edit_budgetMin" className={LABEL_CLASS}>{t('account.requestForm.budgetMin')}</label>
              <input
                id="edit_budgetMin"
                name="budgetMin"
                type="number"
                min="0"
                inputMode="numeric"
                defaultValue={initialPriceMin != null ? String(initialPriceMin) : ''}
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label htmlFor="edit_budgetMax" className={LABEL_CLASS}>{t('account.requestForm.budgetMax')}</label>
              <input
                id="edit_budgetMax"
                name="budgetMax"
                type="number"
                min="0"
                inputMode="numeric"
                defaultValue={initialPriceMax != null ? String(initialPriceMax) : ''}
                className={FIELD_CLASS}
              />
            </div>
          </div>

          <div>
            <label htmlFor="edit_requirementsSummary" className={LABEL_CLASS}>{t('account.requestForm.notesShort')}</label>
            <textarea
              id="edit_requirementsSummary"
              name="requirementsSummary"
              rows={4}
              defaultValue={initialRequirementsSummary || ''}
              placeholder={t('account.requestForm.notesPlaceholder')}
              className="u-focus-ring w-full resize-y rounded-lg border border-line bg-surface p-3 text-sm leading-relaxed text-ink placeholder:text-ink-35"
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <button type="button" className="u-press inline-flex h-11 items-center rounded-lg px-4 text-sm font-semibold text-ink-45 hover:bg-canvas-alt hover:text-ink">
                {t('common.actions.cancel')}
              </button>
            </DialogClose>
            <button
              type="submit"
              disabled={pending}
              className="u-btn-primary u-press h-11 rounded-lg bg-blue px-5 text-sm font-bold text-white disabled:opacity-60"
            >
              {pending ? 'Enregistrement…' : t('common.actions.save')}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
