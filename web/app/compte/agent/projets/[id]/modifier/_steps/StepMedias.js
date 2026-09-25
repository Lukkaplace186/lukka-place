import SafeImage from '@/components/SafeImage';
import ImageUploader from '@/components/projects/wizard/ImageUploader';
import { removeProjectImageAction, saveProjectStepAction, uploadProjectImagesAction } from '../../../actions';
import { Field, INPUT, Section } from './ui';

function uploaderLabels(t, pickKey, hintKey) {
  return {
    pick: t(pickKey),
    hint: hintKey ? t(hintKey) : null,
    optimising: t('agent.projects.wizard.upload.optimising'),
    sending: t('agent.projects.wizard.upload.sending'),
    done: t('agent.projects.wizard.upload.done'),
    failed: t('agent.projects.wizard.uploadFailed'),
    offline: t('agent.projects.wizard.upload.offline'),
    tooLarge: t('agent.projects.wizard.upload.tooLarge'),
  };
}

function Strip({ project, field, t }) {
  const urls = (project[field] || []).filter(Boolean);
  if (!urls.length) return <p className="u-micro text-ink-45">{t('admin.projects.media.none')}</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {urls.map((url, index) => (
        <li key={url} className="flex flex-col gap-1">
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-canvas-alt">
            <SafeImage src={url} alt="" fill sizes="(max-width: 640px) 50vw, 200px" className="object-cover" />
            {index === 0 && field === 'photos' ? (
              <span className="absolute left-1.5 top-1.5 rounded-full bg-ink/80 px-2 py-0.5 text-[0.6875rem] font-semibold text-white">{t('agent.projects.wizard.medias.cover')}</span>
            ) : null}
            {field === 'renders' ? (
              <span className="absolute bottom-1.5 left-1.5 rounded bg-surface/90 px-1.5 py-0.5 text-[0.6875rem] text-ink-70">{t('projects.render')}</span>
            ) : null}
          </div>
          <form action={removeProjectImageAction.bind(null, project.id, field, url)}>
            <button type="submit" className="min-h-9 text-[0.8125rem] font-semibold text-danger hover:underline">{t('admin.projects.media.remove')}</button>
          </form>
        </li>
      ))}
    </ul>
  );
}

/**
 * Step 3 — images, in two separate places on purpose: real photographs of
 * the site as it is, and architect's images, which the public page always
 * labels "Image d'illustration". A buyer must never mistake a render for the
 * building. Unit listings (ready units) take the REAL photos only.
 */
export default function StepMedias({ project, t }) {
  return (
    <div className="flex flex-col gap-4">
      <Section id="photos" title={t('agent.projects.wizard.medias.photosTitle')} intro={t('agent.projects.wizard.medias.photosIntro')}>
        <Strip project={project} field="photos" t={t} />
        <ImageUploader
          action={uploadProjectImagesAction.bind(null, project.id, 'photos')}
          labels={uploaderLabels(t, 'agent.projects.wizard.medias.addPhotos', 'agent.projects.wizard.medias.photosHint')}
        />
      </Section>

      <Section id="rendus" title={t('agent.projects.wizard.medias.rendersTitle')} intro={t('agent.projects.wizard.medias.rendersIntro')}>
        <Strip project={project} field="renders" t={t} />
        <ImageUploader
          action={uploadProjectImagesAction.bind(null, project.id, 'renders')}
          labels={uploaderLabels(t, 'agent.projects.wizard.medias.addRenders', null)}
        />
      </Section>

      <form action={saveProjectStepAction.bind(null, project.id, 'video')}>
        <Section id="video" title={t('agent.projects.wizard.medias.videoTitle')} intro={t('admin.projects.form.videoHint')}>
          <Field label={t('admin.projects.form.video')}>
            <input name="video_url" type="url" defaultValue={project.video_url || ''} placeholder="https://www.youtube.com/watch?v=…" className={INPUT} />
          </Field>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="u-btn-primary inline-flex min-h-11 items-center justify-center rounded-full bg-blue px-5 text-sm font-semibold text-white">
              {t('agent.projects.wizard.saveNext')}
            </button>
          </div>
        </Section>
      </form>
    </div>
  );
}
