'use client';

import { Briefcase, Layers, Store, Truck } from 'lucide-react';
import { FLOOR_OPTIONS, OFFICE_COUNT_MAX, floorLabel } from '@/lib/commercialSpaces';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

/**
 * The four commercial-space fields (lib/commercialSpaces.js), shown in place
 * of "Chambres" when the agent picks an office, shop, warehouse or building.
 * Shared by CreateListingDialog and AgentListingEditor.
 *
 * Uncontrolled named inputs, like the rest of both forms, so drafts and smart
 * paste fill them the same way. `hidden` keeps them mounted (a draft can be
 * restored before the category is known) but out of sight and out of the tab
 * order; the server ignores them unless the category really is commercial.
 *
 * The two yes/no facts are checkboxes that can only say "oui": unticked is
 * "not stated", which is stored as NULL, never as a "no" the agent never said.
 */
export default function CommercialSpecFields({ defaults = {}, hidden = false, fieldClass, labelClass, onChange }) {
  const t = useT();
  const toggleClass =
    'u-focus-ring flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface px-3 text-sm text-ink has-[:checked]:border-blue has-[:checked]:bg-blue-tint';

  return (
    <fieldset hidden={hidden} className={cn('flex flex-col gap-4', hidden && 'hidden')} onChange={onChange}>
      <legend className="mb-1 text-[0.8125rem] font-semibold text-ink-70">
        {t('listings.commercial.form.legend')}
      </legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="office_count" className={labelClass}>
            <Briefcase className="mr-1.5 inline h-4 w-4 align-[-3px] text-ink-45" strokeWidth={1.75} aria-hidden="true" />
            {t('listings.commercial.form.offices')}
          </label>
          <input
            id="office_count"
            name="office_count"
            type="number"
            min="0"
            max={OFFICE_COUNT_MAX}
            step="1"
            inputMode="numeric"
            defaultValue={defaults.office_count ?? ''}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="floor_level" className={labelClass}>
            <Layers className="mr-1.5 inline h-4 w-4 align-[-3px] text-ink-45" strokeWidth={1.75} aria-hidden="true" />
            {t('listings.commercial.form.floor')}
          </label>
          <select id="floor_level" name="floor_level" defaultValue={defaults.floor_level ?? ''} className={fieldClass}>
            <option value="">{t('listings.commercial.form.floorUnknown')}</option>
            {FLOOR_OPTIONS.map((level) => (
              <option key={level} value={level}>{floorLabel(level, t)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className={toggleClass}>
          <input type="checkbox" name="road_frontage" value="1" defaultChecked={defaults.road_frontage === true} className="h-4 w-4 accent-[var(--blue)]" />
          <Store className="h-4 w-4 shrink-0 text-ink-45" strokeWidth={1.75} aria-hidden="true" />
          <span>{t('listings.commercial.form.frontage')}</span>
        </label>
        <label className={toggleClass}>
          <input type="checkbox" name="truck_access" value="1" defaultChecked={defaults.truck_access === true} className="h-4 w-4 accent-[var(--blue)]" />
          <Truck className="h-4 w-4 shrink-0 text-ink-45" strokeWidth={1.75} aria-hidden="true" />
          <span>{t('listings.commercial.form.truck')}</span>
        </label>
      </div>
      <p className="-mt-1 text-xs text-ink-35">{t('listings.commercial.form.hint')}</p>
    </fieldset>
  );
}
