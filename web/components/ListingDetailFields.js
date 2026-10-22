'use client';

import { useState } from 'react';
import { Banknote, Bed, Dumbbell, Fuel, Home, Ruler, Sun, Users, WavesLadder, Zap } from 'lucide-react';
import { EQUIPMENT_FIELDS, HOUSEHOLDS_MAX, INSTALLMENT_TERMS_MAX, PLOT_DIMENSIONS_MAX, parsePlotArea, plotAreaLabel } from '@/lib/listingDetails';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

const boolValue = (v) => (v === true ? '1' : v === false ? '0' : '');

const EQUIPMENT = {
  has_generator: { icon: Fuel, labelKey: 'listings.details.form.generator' },
  has_pool: { icon: WavesLadder, labelKey: 'listings.details.form.pool' },
  has_gym: { icon: Dumbbell, labelKey: 'listings.details.form.gym' },
  has_solar: { icon: Sun, labelKey: 'listings.details.form.solar' },
};

/**
 * The practical details (lib/listingDetails.js): furnished, households in the
 * parcelle, landlord on site, electricity meter, equipment (generator, pool,
 * gym, solar panels), plot size, paiement échelonné. Shared by CreateListingDialog, AgentListingEditor and
 * the admin editor.
 *
 * Uncontrolled named inputs like the rest of those forms, so drafts and smart
 * paste fill them the same way (applyDetailsToForm). `sections`
 * (detailSections) hides the groups that do not apply to the picked category
 * and purpose; hidden groups stay mounted, and the server re-gates every
 * field on the category anyway. Every select starts on "Non précisé", stored
 * as NULL — never a "no" the agent did not say.
 */
export default function ListingDetailFields({ defaults = {}, sections = {}, fieldClass, labelClass, onChange }) {
  const t = useT();
  const [plotText, setPlotText] = useState(defaults.plot_dimensions || '');
  const [installments, setInstallments] = useState(defaults.installments_available === true);
  const plotM2 = plotText.trim() ? parsePlotArea(plotText) : null;
  const show = { living: true, furnished: true, meter: true, equipment: true, plot: true, installments: true, ...sections };
  const toggleClass =
    'u-focus-ring flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface px-3 text-sm text-ink has-[:checked]:border-blue has-[:checked]:bg-blue-tint';
  const notStated = <option value="">{t('listings.details.form.notStated')}</option>;
  const icon = (Icon) => <Icon className="mr-1.5 inline h-4 w-4 align-[-3px] text-ink-45" strokeWidth={1.75} aria-hidden="true" />;

  return (
    <fieldset className="flex flex-col gap-4" onChange={onChange}>
      <legend className="mb-1 text-[0.8125rem] font-semibold text-ink-70">{t('listings.details.form.legend')}</legend>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div hidden={!show.furnished} className={cn(!show.furnished && 'hidden')}>
          <label htmlFor="furnished" className={labelClass}>{icon(Bed)}{t('listings.details.form.furnished')}</label>
          <select id="furnished" name="furnished" defaultValue={boolValue(defaults.furnished)} className={fieldClass}>
            {notStated}
            <option value="1">{t('listings.details.form.furnishedYes')}</option>
            <option value="0">{t('listings.details.form.furnishedNo')}</option>
          </select>
        </div>
        <div hidden={!show.meter} className={cn(!show.meter && 'hidden')}>
          <label htmlFor="electricity_meter" className={labelClass}>{icon(Zap)}{t('listings.details.form.meter')}</label>
          <select id="electricity_meter" name="electricity_meter" defaultValue={defaults.electricity_meter || ''} className={fieldClass}>
            {notStated}
            <option value="prepaye">{t('listings.details.form.meterPrepaye')}</option>
            <option value="individuel">{t('listings.details.form.meterIndividuel')}</option>
            <option value="partage">{t('listings.details.form.meterPartage')}</option>
          </select>
        </div>
      </div>

      <div hidden={!show.living} className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', !show.living && 'hidden')}>
        <div>
          <label htmlFor="households_count" className={labelClass}>{icon(Users)}{t('listings.details.form.households')}</label>
          <input
            id="households_count"
            name="households_count"
            type="number"
            min="1"
            max={HOUSEHOLDS_MAX}
            step="1"
            inputMode="numeric"
            defaultValue={defaults.households_count ?? ''}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="landlord_on_site" className={labelClass}>{icon(Home)}{t('listings.details.form.landlord')}</label>
          <select id="landlord_on_site" name="landlord_on_site" defaultValue={boolValue(defaults.landlord_on_site)} className={fieldClass}>
            {notStated}
            <option value="1">{t('listings.details.form.yes')}</option>
            <option value="0">{t('listings.details.form.no')}</option>
          </select>
        </div>
      </div>

      {/* Equipment: a box can only say "oui"; unticked is "not stated". */}
      <div hidden={!show.equipment} className={cn(!show.equipment && 'hidden')}>
        <span className={labelClass}>{t('listings.details.form.equipment')}</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {EQUIPMENT_FIELDS.map((field) => {
            const { icon: Icon, labelKey } = EQUIPMENT[field];
            return (
              <label key={field} className={toggleClass}>
                <input type="checkbox" name={field} value="1" defaultChecked={defaults[field] === true} className="h-4 w-4 accent-[var(--blue)]" />
                <Icon className="h-4 w-4 shrink-0 text-ink-45" strokeWidth={1.75} aria-hidden="true" />
                <span>{t(labelKey)}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div hidden={!show.plot} className={cn(!show.plot && 'hidden')}>
        <label htmlFor="plot_dimensions" className={labelClass}>{icon(Ruler)}{t('listings.details.form.plot')}</label>
        <input
          id="plot_dimensions"
          name="plot_dimensions"
          type="text"
          maxLength={PLOT_DIMENSIONS_MAX}
          value={plotText}
          onChange={(e) => setPlotText(e.target.value)}
          placeholder={t('listings.details.form.plotPlaceholder')}
          className={fieldClass}
        />
        {plotText.trim() ? (
          <p className={cn('mt-1 text-xs', plotM2 ? 'text-ink-45' : 'text-warning-ink')} aria-live="polite">
            {plotM2
              ? t('listings.details.form.plotComputed', { size: plotAreaLabel(plotM2, t.locale) })
              : t('listings.details.form.plotUnreadable')}
          </p>
        ) : null}
      </div>

      <div hidden={!show.installments} className={cn('flex flex-col gap-2', !show.installments && 'hidden')}>
        <label className="u-focus-ring flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface px-3 text-sm text-ink has-[:checked]:border-blue has-[:checked]:bg-blue-tint">
          <input
            type="checkbox"
            name="installments_available"
            value="1"
            checked={installments}
            onChange={(e) => setInstallments(e.target.checked)}
            className="h-4 w-4 accent-[var(--blue)]"
          />
          <Banknote className="h-4 w-4 shrink-0 text-ink-45" strokeWidth={1.75} aria-hidden="true" />
          <span>{t('listings.details.form.installments')}</span>
        </label>
        {installments ? (
          <div>
            <label htmlFor="installment_terms" className={labelClass}>{t('listings.details.form.installmentTerms')}</label>
            <input
              id="installment_terms"
              name="installment_terms"
              type="text"
              maxLength={INSTALLMENT_TERMS_MAX}
              defaultValue={defaults.installment_terms || ''}
              placeholder={t('listings.details.form.installmentPlaceholder')}
              className={fieldClass}
            />
          </div>
        ) : null}
      </div>

      <p className="-mt-1 text-xs text-ink-35">{t('listings.details.form.hint')}</p>
    </fieldset>
  );
}

/**
 * Smart paste: write the engine's extraction into the fieldset above. Only
 * stated values are written; the plot text goes through the input's own
 * setter so its live preview updates.
 */
export function applyDetailsToForm(form, extracted = {}) {
  if (!form || !extracted) return;
  const setSelect = (name, value) => {
    const el = form.elements[name];
    if (el && value !== null && value !== undefined && value !== '') el.value = String(value);
  };
  if (extracted.furnished === true || extracted.furnished === false) setSelect('furnished', extracted.furnished ? '1' : '0');
  if (extracted.landlord_on_site === true || extracted.landlord_on_site === false) setSelect('landlord_on_site', extracted.landlord_on_site ? '1' : '0');
  setSelect('households_count', extracted.households_count);
  setSelect('electricity_meter', extracted.electricity_meter);
  for (const field of EQUIPMENT_FIELDS) {
    const box = form.elements[field];
    if (box && extracted[field] === true) box.checked = true;
  }
  const plot = form.elements.plot_dimensions;
  if (plot && extracted.plot_dimensions) {
    // A React-controlled input: set through the native setter so onChange fires.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(plot, extracted.plot_dimensions);
    plot.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const box = form.elements.installments_available;
  if (box && extracted.installments_available === true && !box.checked) box.click();
  // The terms field mounts once the box is ticked.
  if (extracted.installment_terms) setTimeout(() => setSelect('installment_terms', extracted.installment_terms), 0);
}
