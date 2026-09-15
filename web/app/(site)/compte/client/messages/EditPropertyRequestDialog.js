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
import { Check } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { MAX_REQUEST_COMMUNES } from '@/lib/leadCommunes';
import { cn } from '@/lib/utils';
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
 * commune select in this app uses (web/CLAUDE.md). Several can be chosen, up
 * to the same cap as the request form: the engine keeps the whole list
 * (`leads.communes`) and pushes the request to agencies in each. This was a
 * single-commune <select> while only one commune could be stored, which
 * meant editing a multi-commune request silently dropped the rest.
 */
export default function EditPropertyRequestDialog({
  leadId,
  action,
  communes,
  transactionType: initialTransactionType,
  selectedCommunes: initialCommunes = [],
  priceMin: initialPriceMin,
  priceMax: initialPriceMax,
  bedrooms: initialBedrooms,
  requirementsSummary: initialRequirementsSummary,
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [transactionTypeValue, setTransactionTypeValue] = useState(initialTransactionType || 'location');
  const [selected, setSelected] = useState(initialCommunes);
  const atCap = selected.length >= MAX_REQUEST_COMMUNES;

  function toggleCommune(name) {
    setSelected((current) => {
      if (current.includes(name)) return current.filter((c) => c !== name);
      if (current.length >= MAX_REQUEST_COMMUNES) return current;
      return [...current, name];
    });
  }

  // A commune stored on the lead but absent from today's option list (the
  // engine's hierarchy was unreachable and the DB fallback is shorter) must
  // still be shown, or it could not be removed and would vanish on save.
  const options = [...communes, ...initialCommunes.filter((c) => !communes.includes(c))];
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
                { value: 'vente', label: t('account.requestForm.buy') },
                { value: 'location', label: t('account.requestForm.rent') },
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

          <fieldset>
            <legend className={LABEL_CLASS}>{t('account.requestForm.targetCommunes')}</legend>
            {selected.map((name) => (
              <input key={name} type="hidden" name="communes" value={name} />
            ))}
            <div className="flex flex-wrap gap-2">
              {options.map((name) => {
                const active = selected.includes(name);
                const disabled = !active && atCap;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleCommune(name)}
                    aria-pressed={active}
                    disabled={disabled}
                    className={cn(
                      'u-press inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.8125rem] font-medium transition-colors',
                      active
                        ? 'bg-blue text-white shadow-[inset_0_0_0_1px_var(--blue)]'
                        : 'bg-surface text-ink-70 shadow-[inset_0_0_0_1px_var(--ink-25)] hover:text-ink',
                      disabled && 'cursor-not-allowed opacity-45',
                    )}
                  >
                    {active ? <Check strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                    {name}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[0.75rem] text-ink-45">
              {t('account.requestForm.communesHint', { max: MAX_REQUEST_COMMUNES })}
            </p>
          </fieldset>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="edit_bedrooms" className={LABEL_CLASS}>{t('account.requests.bedrooms')}</label>
              <select
                id="edit_bedrooms"
                name="bedrooms"
                defaultValue={initialBedrooms != null ? String(initialBedrooms) : ''}
                className={FIELD_CLASS}
              >
                <option value="">{t('account.requestForm.noPreference')}</option>
                {BEDROOM_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value === '4' ? t('account.requestForm.bedrooms4plus') : value}
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
              {pending ? t('common.actions.saving') : t('common.actions.save')}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
