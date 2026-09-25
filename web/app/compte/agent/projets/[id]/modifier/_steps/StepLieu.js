import PinPicker from '@/components/projects/wizard/PinPicker';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { KINSHASA_CENTER, KINSHASA_COMMUNE_CENTROIDS } from '@/lib/geocoding';
import { saveProjectStepAction } from '../../../actions';
import { Field, INPUT, Section, StepButtons } from './ui';

/**
 * Step 2 — where: commune from the real list (never typed), quartier,
 * address, then the pin. The pin opens on the stored point, else the chosen
 * commune's centroid; changing the commune and saving re-centres it.
 */
export default async function StepLieu({ project, t }) {
  const hierarchy = await getLocationHierarchyWithFallback();
  const communes = [...new Set([...(hierarchy.communes || []), ...Object.keys(KINSHASA_COMMUNE_CENTROIDS)])]
    .sort((a, b) => a.localeCompare(b, 'fr'));
  const lat = Number(project.latitude);
  const lng = Number(project.longitude);
  const initial = project.latitude !== null && project.longitude !== null && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const centre = KINSHASA_COMMUNE_CENTROIDS[project.commune] || KINSHASA_CENTER;

  return (
    <form action={saveProjectStepAction.bind(null, project.id, 'lieu')} className="flex flex-col gap-4">
      <Section title={t('agent.projects.wizard.lieu.title')} intro={t('agent.projects.wizard.lieu.intro')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('admin.projects.form.commune')}>
            <select name="commune" required defaultValue={project.commune || ''} className={INPUT}>
              <option value="">—</option>
              {communes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label={t('admin.projects.form.quartier')}>
            <input name="quartier" maxLength={120} defaultValue={project.quartier || ''} className={INPUT} />
          </Field>
          <Field label={t('agent.projects.wizard.lieu.address')} hint={t('agent.projects.wizard.lieu.addressHint')} className="sm:col-span-2">
            <input name="address" maxLength={240} defaultValue={project.address || ''} className={INPUT} />
          </Field>
        </div>
      </Section>

      <Section title={t('agent.projects.wizard.lieu.pinTitle')} intro={t('agent.projects.wizard.lieu.pinIntro')}>
        <PinPicker
          initial={initial}
          centre={centre}
          labels={{
            loading: t('agent.projects.wizard.lieu.mapLoading'),
            dragHint: t('agent.projects.wizard.lieu.dragHint'),
            manualHint: t('agent.projects.wizard.lieu.manualHint'),
            locate: t('agent.projects.wizard.lieu.locate'),
            locating: t('agent.projects.wizard.lieu.locating'),
            locateUnavailable: t('agent.projects.wizard.lieu.locateUnavailable'),
            locateRefused: t('agent.projects.wizard.lieu.locateRefused'),
            clear: t('agent.projects.wizard.lieu.clearPin'),
            noPin: t('agent.projects.wizard.lieu.noPin'),
            latitude: t('admin.projects.form.latitude'),
            longitude: t('admin.projects.form.longitude'),
          }}
        />
      </Section>
      <StepButtons t={t} />
    </form>
  );
}
