import AgentPicker from '../AgentPicker';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { KINSHASA_COMMUNE_CENTROIDS } from '@/lib/geocoding';
import { DEVELOPMENT_STAGES, TITLE_STATUSES, STAGE_LABEL_KEYS, TITLE_STATUS_LABEL_KEYS, dateOnlyInputValue } from '@/lib/developmentRules';
import { getT } from '@/lib/i18n/server';

const PLAN_ROWS = 5;

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="u-micro-strong text-ink-70">{label}</span>
      {children}
      {hint ? <span className="text-[0.75rem] text-ink-45">{hint}</span> : null}
    </label>
  );
}

const INPUT = 'min-h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink';


/**
 * The project's own facts. One form for create and edit; `action` decides
 * which. Communes come from the engine's hierarchy (plus the 24 verified
 * centroids), never typed — the action re-validates against the same list.
 */
export default async function ProjectDetailsForm({ action, project = null, submitLabel }) {
  const t = await getT();
  const hierarchy = await getLocationHierarchyWithFallback();
  const communes = [...new Set([...(hierarchy.communes || []), ...Object.keys(KINSHASA_COMMUNE_CENTROIDS)])].sort((a, b) => a.localeCompare(b, 'fr'));
  const plan = Array.isArray(project?.payment_plan) ? project.payment_plan : [];
  const kind = project?.kind || 'building';

  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('admin.projects.form.name')}>
          <input name="name" required maxLength={140} defaultValue={project?.name || ''} className={INPUT} />
        </Field>
        <Field label={t('admin.projects.form.kind')} hint={project ? t('admin.projects.form.kindHint') : null}>
          <select name="kind" defaultValue={kind} className={INPUT}>
            <option value="building">{t('admin.projects.kinds.building')}</option>
            <option value="land">{t('admin.projects.kinds.land')}</option>
          </select>
        </Field>
        <Field label={t('admin.projects.form.stage')} hint={t('admin.projects.form.stageHint')}>
          <select name="stage" defaultValue={project?.stage || 'under_construction'} className={INPUT}>
            {DEVELOPMENT_STAGES.map((stage) => <option key={stage} value={stage}>{t(STAGE_LABEL_KEYS[stage])}</option>)}
          </select>
        </Field>
        <Field label={t('admin.projects.form.delivery')} hint={t('admin.projects.form.deliveryHint')}>
          <input type="date" name="delivery_expected" defaultValue={dateOnlyInputValue(project?.delivery_expected)} className={INPUT} />
        </Field>
        <Field label={t('admin.projects.form.purpose')}>
          <select name="purpose" defaultValue={project?.purpose || 'sale'} className={INPUT}>
            <option value="sale">{t('admin.projects.purposes.sale')}</option>
            <option value="rent">{t('admin.projects.purposes.rent')}</option>
            <option value="mixed">{t('admin.projects.purposes.mixed')}</option>
          </select>
        </Field>
        <Field label={t('admin.projects.form.developerAccount')} hint={t('admin.projects.form.developerAccountHint')}>
          <AgentPicker
            name="agent_id"
            allowClear
            defaultAgent={project?.agent_id ? { id: project.agent_id, name: project.agency_name || `Agent #${project.agent_id}` } : null}
            placeholder={t('admin.projects.form.chooseDeveloper')}
          />
        </Field>
        <Field label={t('admin.projects.form.developerName')} hint={t('admin.projects.form.developerNameHint')}>
          <input name="developer_name" maxLength={140} defaultValue={project?.developer_name || ''} className={INPUT} />
        </Field>
        <Field label={t('admin.projects.form.commune')}>
          <select name="commune" defaultValue={project?.commune || ''} className={INPUT}>
            <option value="">—</option>
            {communes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label={t('admin.projects.form.quartier')}>
          <input name="quartier" maxLength={120} defaultValue={project?.quartier || ''} className={INPUT} />
        </Field>
        <Field label={t('admin.projects.form.address')}>
          <input name="address" maxLength={240} defaultValue={project?.address || ''} className={INPUT} />
        </Field>
        <Field label={t('admin.projects.form.latitude')} hint={t('admin.projects.form.coordinatesHint')}>
          <input name="latitude" inputMode="decimal" defaultValue={project?.latitude ?? ''} placeholder="-4.3250" className={INPUT} />
        </Field>
        <Field label={t('admin.projects.form.longitude')}>
          <input name="longitude" inputMode="decimal" defaultValue={project?.longitude ?? ''} placeholder="15.3120" className={INPUT} />
        </Field>
        <Field label={t('admin.projects.form.video')} hint={t('admin.projects.form.videoHint')}>
          <input name="video_url" type="url" defaultValue={project?.video_url || ''} placeholder="https://www.youtube.com/watch?v=…" className={INPUT} />
        </Field>
      </div>

      <fieldset className="grid gap-4 rounded-lg border border-line p-4 sm:grid-cols-2">
        <legend className="px-1 u-micro-strong text-ink">{t('admin.projects.form.landLegend')}</legend>
        <Field label={t('admin.projects.form.landArea')}>
          <input name="land_area_m2" inputMode="decimal" defaultValue={project?.land_area_m2 ?? ''} className={INPUT} />
        </Field>
        <Field label={t('admin.projects.form.landTitle')}>
          <select name="land_title_status" defaultValue={project?.land_title_status || ''} className={INPUT}>
            <option value="">—</option>
            {TITLE_STATUSES.map((s) => <option key={s} value={s}>{t(TITLE_STATUS_LABEL_KEYS[s])}</option>)}
          </select>
        </Field>
      </fieldset>

      <Field label={t('admin.projects.form.description')}>
        <textarea name="description" rows={6} maxLength={6000} defaultValue={project?.description || ''} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" />
      </Field>
      <Field label={t('admin.projects.form.amenities')} hint={t('admin.projects.form.amenitiesHint')}>
        <textarea name="amenities" rows={2} defaultValue={(project?.amenities || []).join(', ')} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" />
      </Field>

      <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-4">
        <legend className="px-1 u-micro-strong text-ink">{t('admin.projects.form.planLegend')}</legend>
        <p className="text-[0.75rem] text-ink-45">{t('admin.projects.form.planHint')}</p>
        {Array.from({ length: PLAN_ROWS }, (_, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
            <input name="plan_label" defaultValue={plan[i]?.label || ''} placeholder={i === 0 ? t('admin.projects.form.planLabelExample') : ''} aria-label={t('admin.projects.form.planLabel')} className={INPUT} />
            <input name="plan_percent" inputMode="decimal" defaultValue={plan[i]?.percent ?? ''} placeholder="%" aria-label={t('admin.projects.form.planPercent')} className={INPUT} />
          </div>
        ))}
      </fieldset>

      <button type="submit" className="u-btn-primary inline-flex min-h-11 items-center justify-center self-start rounded-full bg-blue px-6 text-sm font-semibold text-white">
        {submitLabel}
      </button>
    </form>
  );
}
