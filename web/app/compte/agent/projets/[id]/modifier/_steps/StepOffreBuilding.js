import Link from 'next/link';
import { ExternalLink, Trash2 } from 'lucide-react';
import PasteImport from '@/components/projects/wizard/PasteImport';
import { getPropertyCategories } from '@/lib/agentListings';
import { unitListingState } from '@/lib/developmentRules';
import { unitCreationBlocker } from '@/lib/projectUnits';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import {
  deleteUnitAction, deleteUnitTypeAction, generateUnitsAction, importUnitTypesAction, importUnitsAction, saveUnitTypeAction,
} from '../../../actions';
import { Field, INPUT, PRIMARY, SECONDARY, Section, usd } from './ui';

const STATE_TONE = {
  available: 'bg-success-tint text-success',
  reserved: 'bg-warning-tint text-ink',
  taken: 'bg-ink text-white',
  pending: 'bg-canvas-alt text-ink-70',
  withdrawn: 'bg-canvas-alt text-ink-45',
};

function pasteLabels(t, kind) {
  const errors = {};
  for (const key of ['unitLabel', 'priceRange', 'units', 'lotLabel', 'share', 'polygon', 'floor', 'unitPrice', 'pasteNumber', 'generic']) {
    errors[`admin.projects.errors.${key}`] = t(`admin.projects.errors.${key}`);
  }
  errors.generic = t('admin.projects.errors.generic');
  return {
    open: t(`agent.projects.wizard.paste.open.${kind}`),
    intro: t('agent.projects.wizard.paste.intro'),
    placeholder: t(`agent.projects.wizard.paste.placeholder.${kind}`),
    headerSkipped: t('agent.projects.wizard.paste.headerSkipped'),
    truncated: t('agent.projects.wizard.paste.truncated'),
    submit: t('agent.projects.wizard.paste.submit'),
    cancel: t('agent.projects.wizard.cancel'),
    columns: {
      label: t('agent.projects.wizard.paste.columns.label'),
      bedrooms: t('admin.projects.units.bedrooms'),
      bathrooms: t('admin.projects.units.bathrooms'),
      area_m2: t('admin.projects.units.area'),
      price_min: t('admin.projects.units.priceMin'),
      price_max: t('admin.projects.units.priceMax'),
      units_total: t('admin.projects.units.total'),
      units_available: t('admin.projects.units.available'),
      price: t('admin.projects.lots.price'),
      floor: t('agent.projects.wizard.units.floor'),
    },
    errors,
  };
}

function Num({ name, label, value, step = 'any', required = false }) {
  return (
    <Field label={label}>
      <input name={name} type="number" step={step} min="0" required={required} defaultValue={value ?? ''} className={INPUT} />
    </Field>
  );
}

function UnitTypeFields({ unit = null, t, categories }) {
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <Field label={t('admin.projects.units.label')} className="sm:col-span-2">
        <input name="label" required maxLength={80} defaultValue={unit?.label || ''} placeholder={t('agent.projects.wizard.units.labelExample')} className={INPUT} />
      </Field>
      <Field label={t('admin.projects.units.purpose')}>
        <select name="purpose" defaultValue={unit?.purpose || 'sale'} className={INPUT}>
          <option value="sale">{t('admin.projects.purposes.sale')}</option>
          <option value="rent">{t('admin.projects.purposes.rent')}</option>
        </select>
      </Field>
      <Field label={t('admin.projects.units.period')}>
        <select name="price_period" defaultValue={unit?.price_period || 'month'} className={INPUT}>
          <option value="month">{t('admin.projects.units.month')}</option>
          <option value="year">{t('admin.projects.units.year')}</option>
        </select>
      </Field>
      <Num name="bedrooms" label={t('admin.projects.units.bedrooms')} value={unit?.bedrooms} step="1" />
      <Num name="bathrooms" label={t('admin.projects.units.bathrooms')} value={unit?.bathrooms} step="1" />
      <Num name="area_m2" label={t('admin.projects.units.area')} value={unit?.area_m2} />
      <Field label={t('agent.projects.wizard.units.category')}>
        <select name="category_id" defaultValue={unit?.category_id ?? ''} className={INPUT}>
          <option value="">{t('agent.projects.wizard.units.categoryDefault')}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Num name="price_min" label={t('admin.projects.units.priceMin')} value={unit?.price_min} />
      <Num name="price_max" label={t('admin.projects.units.priceMax')} value={unit?.price_max} />
      {unit?.counted ? null : (
        <>
          <Num name="units_total" label={t('admin.projects.units.total')} value={unit?.units_total} step="1" />
          <Num name="units_available" label={t('admin.projects.units.available')} value={unit?.units_available} step="1" />
        </>
      )}
      <input type="hidden" name="sort_order" value={unit?.sort_order ?? 0} />
      <label className="flex min-h-11 items-start gap-2.5 rounded-lg border border-line bg-canvas-alt p-3 text-sm sm:col-span-4">
        <input type="checkbox" name="ready_now" defaultChecked={Boolean(unit?.ready_now)} className="mt-0.5 h-4 w-4 accent-[var(--color-blue)]" />
        <span>
          <span className="font-semibold text-ink">{t('agent.projects.wizard.units.readyNow')}</span>
          <span className="block text-[0.8125rem] text-ink-70">{t('agent.projects.wizard.units.readyNowHint')}</span>
        </span>
      </label>
    </div>
  );
}

function UnitsOfType({ project, unit, t }) {
  const blocker = unitCreationBlocker(project, unit);
  const units = unit.live_units || [];
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-blue/30 bg-blue-tint/40 p-3 sm:p-4">
      <div>
        <p className="u-title-sub text-ink">{t('agent.projects.wizard.units.listTitle', { count: units.length })}</p>
        <p className="text-[0.8125rem] text-ink-70">{t('agent.projects.wizard.units.listIntro')}</p>
      </div>

      {units.length ? (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
          {units.map((u) => {
            const state = unitListingState(u);
            return (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="text-sm font-semibold text-ink">
                  {u.unit_label}
                  {u.unit_floor !== null && u.unit_floor !== undefined ? (
                    <span className="ml-1.5 font-normal text-ink-45">· {u.unit_floor === 0 ? t('agent.projects.wizard.units.groundFloor') : t('agent.projects.wizard.units.floorN', { floor: u.unit_floor })}</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-2">
                  <span className="u-tabular text-sm text-ink">{usd(u.price)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${STATE_TONE[state]}`}>
                    {t(`agent.projects.wizard.units.state.${state}`)}
                  </span>
                  {state === 'pending' ? (
                    <form action={deleteUnitAction.bind(null, project.id, u.id)}>
                      <button type="submit" aria-label={t('agent.projects.wizard.units.deleteUnit')} className="u-hit relative p-1 text-ink-45 hover:text-danger">
                        <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                      </button>
                    </form>
                  ) : (
                    <Link href={`/compte/agent/biens/${u.id}/edit`} className="inline-flex items-center gap-1 text-[0.8125rem] font-semibold text-blue-deep hover:underline">
                      {t('agent.projects.wizard.units.manage')}
                      <ExternalLink strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {blocker ? (
        <p className="rounded-lg bg-warning-tint px-3 py-2 text-[0.8125rem] text-ink">
          {t(`agent.projects.wizard.errors.units_${blocker}`)}{' '}
          {blocker === 'requiresPhoto' ? (
            <Link href={`/compte/agent/projets/${project.id}/modifier?step=medias#photos`} className="font-semibold text-blue-deep hover:underline">
              {t('agent.projects.wizard.units.goPhotos')}
            </Link>
          ) : null}
        </p>
      ) : (
        <>
          <details className="rounded-lg border border-line bg-surface p-3" open={!units.length}>
            <summary className="cursor-pointer text-sm font-semibold text-ink">{t('agent.projects.wizard.units.generatorTitle')}</summary>
            <form action={generateUnitsAction.bind(null, project.id, unit.id)} className="mt-3 grid gap-3 sm:grid-cols-6">
              <Field label={t('agent.projects.wizard.units.fromFloor')} hint={t('agent.projects.wizard.units.groundHint')}>
                <input name="from" type="number" min="0" max="99" defaultValue="1" required className={INPUT} />
              </Field>
              <Field label={t('agent.projects.wizard.units.toFloor')}>
                <input name="to" type="number" min="0" max="99" defaultValue="1" required className={INPUT} />
              </Field>
              <Field label={t('agent.projects.wizard.units.perFloor')}>
                <input name="per_floor" type="number" min="1" max="26" defaultValue="2" required className={INPUT} />
              </Field>
              <Field label={t('agent.projects.wizard.units.naming')}>
                <select name="naming" defaultValue="letters" className={INPUT}>
                  <option value="letters">1A, 1B…</option>
                  <option value="numbers">101, 102…</option>
                </select>
              </Field>
              <Field label={t('agent.projects.wizard.units.prefix')}>
                <input name="prefix" maxLength={20} defaultValue="Apt " className={INPUT} />
              </Field>
              <Field label={t('agent.projects.wizard.units.price')} hint={t('agent.projects.wizard.units.priceHint')}>
                <input name="price" type="number" min="1" step="any" defaultValue={unit.price_min ?? unit.price_max ?? ''} required className={INPUT} />
              </Field>
              <button type="submit" className={`${PRIMARY} sm:col-span-6 sm:justify-self-start`}>{t('agent.projects.wizard.units.generate')}</button>
            </form>
          </details>
          <PasteImport
            action={importUnitsAction.bind(null, project.id, unit.id)}
            kind="units"
            context={{ unitType: { price_min: unit.price_min, price_max: unit.price_max } }}
            labels={pasteLabels(t, 'units')}
          />
        </>
      )}
    </div>
  );
}

/**
 * Step 4 (building) — the price grid, one card per unit type. A type ticked
 * "Disponible maintenant" gets its individual units, and each becomes a real
 * listing on the main map (one pin for the whole building): created through
 * the ordinary listing path, reviewed with the project.
 */
export default async function StepOffreBuilding({ project, t }) {
  const categories = await getPropertyCategories().catch(() => []);
  const types = project.unit_types || [];

  return (
    <div className="flex flex-col gap-4">
      <Section id="types" title={t('agent.projects.wizard.offre.buildingTitle')} intro={t('agent.projects.wizard.offre.buildingIntro')}>
        {types.length ? null : <p className="rounded-lg bg-canvas-alt px-3 py-2 text-sm text-ink-70">{t('agent.projects.wizard.offre.noTypes')}</p>}
        {types.map((unit) => (
          <article key={unit.id} id={`type-${unit.id}`} className="flex scroll-mt-28 flex-col gap-3 rounded-card border border-line p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">{unit.label}</p>
                <p className="text-[0.8125rem] text-ink-70">
                  {[
                    unit.bedrooms !== null ? t('projects.card.beds', { count: unit.bedrooms }) : null,
                    unit.price_min !== null ? `${t('projects.card.from')} ${usd(unit.price_min)}` : t('projects.card.priceOnRequest'),
                    unit.units_available !== null && unit.units_available !== undefined
                      ? t('agent.projects.wizard.units.availableShort', { count: unit.units_available })
                      : null,
                    unit.counted ? t('agent.projects.wizard.units.counted') : null,
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>
              <form action={deleteUnitTypeAction.bind(null, project.id, unit.id)}>
                <button type="submit" className="inline-flex min-h-9 items-center gap-1 text-[0.8125rem] font-semibold text-danger hover:underline">
                  <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                  {t('admin.projects.delete')}
                </button>
              </form>
            </div>
            <details className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold text-blue-deep">{t('agent.projects.wizard.units.edit')}</summary>
              <form action={saveUnitTypeAction.bind(null, project.id, unit.id)} className="mt-3 flex flex-col gap-3">
                <UnitTypeFields unit={unit} t={t} categories={categories} />
                <button type="submit" className={`${SECONDARY} self-start`}>{t('admin.projects.save')}</button>
              </form>
            </details>
            {unit.ready_now ? <UnitsOfType project={project} unit={unit} t={t} /> : null}
          </article>
        ))}
      </Section>

      <Section id="new-type" title={t('admin.projects.units.new')} intro={t('agent.projects.wizard.units.newIntro')}>
        <form action={saveUnitTypeAction.bind(null, project.id, null)} className="flex flex-col gap-3">
          <UnitTypeFields t={t} categories={categories} />
          <button type="submit" className={`${PRIMARY} self-start`}>{t('admin.projects.units.add')}</button>
        </form>
        <PasteImport
          action={importUnitTypesAction.bind(null, project.id)}
          kind="unitTypes"
          context={{ purpose: project.purpose === 'rent' ? 'rent' : 'sale' }}
          hidden={{ purpose: project.purpose === 'rent' ? 'rent' : 'sale' }}
          labels={pasteLabels(t, 'unitTypes')}
        />
      </Section>
    </div>
  );
}
