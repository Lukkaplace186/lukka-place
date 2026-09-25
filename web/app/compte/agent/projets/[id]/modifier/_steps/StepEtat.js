import { DEVELOPMENT_STAGES, STAGE_LABEL_KEYS, TITLE_STATUSES, TITLE_STATUS_LABEL_KEYS, dateOnlyInputValue } from '@/lib/developmentRules';
import { saveProjectStepAction } from '../../../actions';
import { Field, INPUT, Section, StepButtons, TEXTAREA } from './ui';

/**
 * Step 1 — what the project is: name, stage and delivery (a building) or the
 * parcel's area, title and how it is sold (land), then the words a buyer reads.
 */
export default function StepEtat({ project, t }) {
  const building = project.kind === 'building';
  const delivery = dateOnlyInputValue(project.delivery_expected).slice(0, 7);

  return (
    <form action={saveProjectStepAction.bind(null, project.id, 'etat')} className="flex flex-col gap-4">
      <Section title={t('agent.projects.wizard.etat.title')} intro={t(building ? 'agent.projects.wizard.etat.introBuilding' : 'agent.projects.wizard.etat.introLand')}>
        <Field label={t('agent.projects.wizard.nameLabel')}>
          <input name="name" required maxLength={140} defaultValue={project.name} className={INPUT} />
        </Field>

        {building ? (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="u-micro-strong mb-1 text-ink-70">{t('agent.projects.wizard.etat.stage')}</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {DEVELOPMENT_STAGES.map((stage) => (
                  <label key={stage} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink has-[:checked]:border-blue has-[:checked]:bg-blue-tint">
                    <input type="radio" name="stage" value={stage} defaultChecked={(project.stage || 'under_construction') === stage} className="accent-[var(--color-blue)]" />
                    {t(STAGE_LABEL_KEYS[stage])}
                  </label>
                ))}
              </div>
              <p className="text-[0.75rem] text-ink-45">{t('agent.projects.wizard.etat.stageHint')}</p>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('agent.projects.wizard.etat.delivery')} hint={t('agent.projects.wizard.etat.deliveryHint')}>
                <input type="month" name="delivery_expected" defaultValue={delivery} className={INPUT} />
              </Field>
              <Field label={t('agent.projects.wizard.etat.purpose')}>
                <select name="purpose" defaultValue={project.purpose || 'sale'} className={INPUT}>
                  <option value="sale">{t('admin.projects.purposes.sale')}</option>
                  <option value="rent">{t('admin.projects.purposes.rent')}</option>
                  <option value="mixed">{t('admin.projects.purposes.mixed')}</option>
                </select>
              </Field>
            </div>
          </>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('agent.projects.wizard.etat.landMode')}>
              <select name="land_mode" defaultValue={project.land_mode || 'lots'} className={INPUT}>
                <option value="portions">{t('agent.projects.wizard.types.portions.title')}</option>
                <option value="lots">{t('agent.projects.wizard.types.lots.title')}</option>
              </select>
            </Field>
            <Field label={t('agent.projects.wizard.etat.landArea')} hint={t('agent.projects.wizard.etat.landAreaHint')}>
              <input name="land_area_m2" inputMode="decimal" required defaultValue={project.land_area_m2 ?? ''} className={INPUT} />
            </Field>
            <Field label={t('admin.projects.form.landTitle')} hint={t('agent.projects.wizard.etat.titleHint')}>
              <select name="land_title_status" defaultValue={project.land_title_status || ''} className={INPUT}>
                <option value="">—</option>
                {TITLE_STATUSES.map((s) => <option key={s} value={s}>{t(TITLE_STATUS_LABEL_KEYS[s])}</option>)}
              </select>
            </Field>
          </div>
        )}

        <Field label={t('agent.projects.wizard.etat.description')} hint={t('agent.projects.wizard.etat.descriptionHint')}>
          <textarea name="description" rows={6} maxLength={6000} required={building} defaultValue={project.description || ''} className={TEXTAREA} />
        </Field>
        <Field label={t('admin.projects.form.amenities')} hint={t('admin.projects.form.amenitiesHint')}>
          <textarea name="amenities" rows={2} defaultValue={(project.amenities || []).join(', ')} placeholder={t('agent.projects.wizard.etat.amenitiesExample')} className={TEXTAREA} />
        </Field>
      </Section>
      <StepButtons t={t} />
    </form>
  );
}
