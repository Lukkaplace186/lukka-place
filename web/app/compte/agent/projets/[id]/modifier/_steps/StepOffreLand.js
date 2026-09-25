import { Trash2 } from 'lucide-react';
import PasteImport from '@/components/projects/wizard/PasteImport';
import PortionForm from '@/components/projects/wizard/PortionForm';
import ImageUploader from '@/components/projects/wizard/ImageUploader';
import LotPlanEditor from '@/components/projects/LotPlanEditor';
import {
  LOT_STATUSES, LOT_STATUS_LABEL_KEYS, portionPriceWarnings, portionRows, pricePerM2,
} from '@/lib/developmentRules';
import { planEditorLabels } from '@/lib/projectLabels';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import {
  deleteLotAction, generateLotsAction, importLotsAction, saveLotAction, setTraceByTeamAction, uploadProjectImagesAction,
} from '../../../actions';
import { Field, INPUT, PRIMARY, SECONDARY, Section, usd } from './ui';

function statusOptions(t) {
  return LOT_STATUSES.map((value) => ({ value, label: t(LOT_STATUS_LABEL_KEYS[value]) }));
}

function portionLabels(t) {
  return {
    presets: t('agent.projects.wizard.portions.presets'),
    share: t('admin.projects.lots.share'),
    price: t('admin.projects.lots.price'),
    status: t('admin.projects.lots.status'),
    noArea: t('agent.projects.wizard.portions.noArea'),
    save: t('admin.projects.save'),
    add: t('agent.projects.wizard.portions.add'),
  };
}

function Portions({ project, t }) {
  const landArea = project.land_area_m2 !== null && project.land_area_m2 !== undefined ? Number(project.land_area_m2) : null;
  const rows = portionRows(project.lots || [], landArea);
  const warnings = portionPriceWarnings(rows);
  const taken = rows.filter((r) => r.status !== 'available').reduce((sum, r) => sum + r.share, 0);

  return (
    <Section id="lots" title={t('agent.projects.wizard.portions.title')} intro={t('agent.projects.wizard.portions.intro')}>
      {landArea === null ? (
        <p className="rounded-lg bg-warning-tint px-3 py-2 text-sm text-ink">{t('agent.projects.wizard.portions.needArea')}</p>
      ) : (
        <p className="text-sm text-ink-70">{t('agent.projects.wizard.portions.parcel', { area: landArea.toLocaleString('fr-FR') })}</p>
      )}
      {taken > 0 ? <p className="text-[0.8125rem] font-semibold text-ink">{t('agent.projects.wizard.portions.taken', { share: taken, left: Math.max(0, 100 - taken) })}</p> : null}

      {rows.map((row) => (
        <article key={row.id} id={`lot-${row.id}`} className="flex scroll-mt-28 flex-col gap-2 rounded-card border border-line p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-ink">
              {row.share} %
              {row.blocked ? <span className="ml-2 rounded-full bg-canvas-alt px-2 py-0.5 text-[0.6875rem] font-semibold text-ink-70">{t('agent.projects.wizard.portions.blocked')}</span> : null}
            </p>
            <form action={deleteLotAction.bind(null, project.id, row.id)}>
              <button type="submit" className="inline-flex min-h-9 items-center gap-1 text-[0.8125rem] font-semibold text-danger hover:underline">
                <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                {t('admin.projects.delete')}
              </button>
            </form>
          </div>
          <PortionForm
            action={saveLotAction.bind(null, project.id, row.id)}
            landArea={landArea}
            portion={{ share: row.share, price: row.price ?? '', status: row.status }}
            statuses={statusOptions(t)}
            labels={portionLabels(t)}
            warning={warnings.has(row.id) ? t('agent.projects.wizard.portions.priceWarning') : null}
          />
        </article>
      ))}

      <div className="flex flex-col gap-2 rounded-card border border-dashed border-ink-25 p-3 sm:p-4">
        <p className="u-title-sub text-ink">{t('agent.projects.wizard.portions.new')}</p>
        <PortionForm action={saveLotAction.bind(null, project.id, null)} landArea={landArea} labels={portionLabels(t)} />
      </div>
    </Section>
  );
}

function LotFields({ lot = null, t }) {
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <Field label={t('admin.projects.lots.label')}>
        <input name="label" required maxLength={60} defaultValue={lot?.label || ''} placeholder="Lot 1" className={INPUT} />
      </Field>
      <Field label={t('admin.projects.lots.area')}>
        <input name="area_m2" type="number" min="0" step="any" defaultValue={lot?.area_m2 ?? ''} className={INPUT} />
      </Field>
      <Field label={t('admin.projects.lots.price')}>
        <input name="price" type="number" min="0" step="any" defaultValue={lot?.price ?? ''} className={INPUT} />
      </Field>
      <Field label={t('admin.projects.lots.status')}>
        <select name="status" defaultValue={lot?.status || 'available'} className={INPUT}>
          {statusOptions(t).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </Field>
      <input type="hidden" name="sort_order" value={lot?.sort_order ?? 0} />
    </div>
  );
}

function Lots({ project, t }) {
  const lots = project.lots || [];
  const traced = lots.filter((l) => Array.isArray(l.polygon)).length;
  const others = (lot) => lots.filter((l) => l.id !== lot.id && Array.isArray(l.polygon)).map((l) => l.polygon);

  return (
    <>
      <Section id="plan" title={t('admin.projects.lots.planTitle')} intro={t('agent.projects.wizard.lots.planIntro')}>
        {project.plan_image ? (
          <div className="relative max-w-md overflow-hidden rounded-lg border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element -- the plan's own aspect ratio is the geometry */}
            <img src={project.plan_image} alt="" className="block h-auto w-full" />
          </div>
        ) : null}
        <ImageUploader
          action={uploadProjectImagesAction.bind(null, project.id, 'plan')}
          multiple={false}
          labels={{
            pick: project.plan_image ? t('admin.projects.lots.replacePlan') : t('admin.projects.lots.uploadPlan'),
            hint: t('agent.projects.wizard.lots.planHint'),
            optimising: t('agent.projects.wizard.upload.optimising'),
            sending: t('agent.projects.wizard.upload.sending'),
            done: t('agent.projects.wizard.upload.done'),
            failed: t('agent.projects.wizard.uploadFailed'),
            offline: t('agent.projects.wizard.upload.offline'),
            tooLarge: t('agent.projects.wizard.upload.tooLarge'),
          }}
        />
        {project.plan_image ? (
          <form action={setTraceByTeamAction.bind(null, project.id)} className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="trace_by_team" defaultChecked={Boolean(project.trace_by_team)} className="h-4 w-4 accent-[var(--color-blue)]" />
              {t('agent.projects.wizard.lots.traceByTeam')}
            </label>
            <button type="submit" className={SECONDARY}>{t('admin.projects.save')}</button>
            <p className="w-full text-[0.75rem] text-ink-45">{t('agent.projects.wizard.lots.tracedCount', { traced, total: lots.length })}</p>
          </form>
        ) : null}
      </Section>

      <Section id="lots" title={t('agent.projects.wizard.lots.title')} intro={t('agent.projects.wizard.lots.intro')}>
        {lots.map((lot) => {
          const perM2 = pricePerM2(lot.price, lot.area_m2);
          return (
            <details key={lot.id} id={`lot-${lot.id}`} className="scroll-mt-28 rounded-lg border border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold text-ink">
                {lot.label} · {t(LOT_STATUS_LABEL_KEYS[lot.status])}
                {lot.area_m2 !== null ? ` · ${Number(lot.area_m2).toLocaleString('fr-FR')} m²` : ''}
                {lot.price !== null ? ` · ${usd(lot.price)}` : ''}
                {perM2 !== null ? ` · ${perM2.toLocaleString('fr-FR')} $/m²` : ''}
                {Array.isArray(lot.polygon) ? ` · ${t('admin.projects.lots.traced')}` : ''}
              </summary>
              <form action={saveLotAction.bind(null, project.id, lot.id)} className="mt-3 flex flex-col gap-3">
                <LotFields lot={lot} t={t} />
                {project.plan_image && !project.trace_by_team ? (
                  <LotPlanEditor planImage={project.plan_image} initial={lot.polygon || null} others={others(lot)} labels={planEditorLabels(t)} />
                ) : Array.isArray(lot.polygon) ? <input type="hidden" name="polygon" value={lot.polygon.map(([x, y]) => `${x},${y}`).join(' ')} /> : null}
                <button type="submit" className={`${SECONDARY} self-start`}>{t('admin.projects.save')}</button>
              </form>
              <form action={deleteLotAction.bind(null, project.id, lot.id)} className="mt-2">
                <button type="submit" className="inline-flex min-h-9 items-center gap-1 text-[0.8125rem] font-semibold text-danger hover:underline">
                  <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                  {t('admin.projects.delete')}
                </button>
              </form>
            </details>
          );
        })}

        <details className="rounded-lg border border-line bg-canvas-alt p-3" open={!lots.length}>
          <summary className="cursor-pointer text-sm font-semibold text-ink">{t('agent.projects.wizard.lots.generatorTitle')}</summary>
          <form action={generateLotsAction.bind(null, project.id)} className="mt-3 grid gap-3 sm:grid-cols-5">
            <Field label={t('agent.projects.wizard.lots.count')}>
              <input name="count" type="number" min="1" max="300" defaultValue="10" required className={INPUT} />
            </Field>
            <Field label={t('agent.projects.wizard.lots.start')}>
              <input name="start" type="number" min="1" defaultValue={lots.length + 1} className={INPUT} />
            </Field>
            <Field label={t('agent.projects.wizard.lots.prefix')}>
              <input name="prefix" maxLength={20} defaultValue="Lot " className={INPUT} />
            </Field>
            <Field label={t('admin.projects.lots.area')}>
              <input name="area_m2" type="number" min="0" step="any" className={INPUT} />
            </Field>
            <Field label={t('admin.projects.lots.price')}>
              <input name="price" type="number" min="0" step="any" className={INPUT} />
            </Field>
            <button type="submit" className={`${PRIMARY} sm:col-span-5 sm:justify-self-start`}>{t('agent.projects.wizard.lots.generate')}</button>
          </form>
        </details>

        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink">{t('admin.projects.lots.new')}</summary>
          <form action={saveLotAction.bind(null, project.id, null)} className="mt-3 flex flex-col gap-3">
            <LotFields t={t} />
            <button type="submit" className={`${PRIMARY} self-start`}>{t('admin.projects.lots.add')}</button>
          </form>
        </details>

        <PasteImport action={importLotsAction.bind(null, project.id)} kind="lots" labels={{
          open: t('agent.projects.wizard.paste.open.lots'),
          intro: t('agent.projects.wizard.paste.intro'),
          placeholder: t('agent.projects.wizard.paste.placeholder.lots'),
          headerSkipped: t('agent.projects.wizard.paste.headerSkipped'),
          truncated: t('agent.projects.wizard.paste.truncated'),
          submit: t('agent.projects.wizard.paste.submit'),
          cancel: t('agent.projects.wizard.cancel'),
          columns: { label: t('agent.projects.wizard.paste.columns.label'), area_m2: t('admin.projects.lots.area'), price: t('admin.projects.lots.price') },
          errors: {
            'admin.projects.errors.lotLabel': t('admin.projects.errors.lotLabel'),
            'admin.projects.errors.pasteNumber': t('admin.projects.errors.pasteNumber'),
            generic: t('admin.projects.errors.generic'),
          },
        }} />
      </Section>
    </>
  );
}

/** Step 4 (land) — portions of one parcel, or the lots of a lotissement. */
export default function StepOffreLand({ project, t }) {
  return project.land_mode === 'portions' ? <Portions project={project} t={t} /> : <Lots project={project} t={t} />;
}
