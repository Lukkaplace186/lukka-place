'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { SEO_DESCRIPTION_MAX, SEO_IMAGE_URL_MAX, SEO_LANGUAGES, SEO_TITLE_MAX } from '@/lib/siteSettingsRules';
import { saveSeoSettingsAction } from './actions';

const LABEL = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45';
const INPUT = 'u-micro w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink focus:border-blue focus:outline-none';
const BUTTON = 'u-press u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue px-3 text-white hover:bg-blue-deep disabled:opacity-50';

/**
 * "Optimisation SEO & Meta": the site's default title and meta description
 * per language, and the default Open Graph image. An empty field keeps the
 * dictionary's text (shown as the placeholder), so the form says what the
 * site uses today. A page's own metadata still replaces these.
 */
export default function SeoPanel({ seo, defaults, updatedLabel }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState(null);
  const [field, setField] = useState(null);
  const [lengths, setLengths] = useState(() => {
    const out = {};
    for (const lang of SEO_LANGUAGES) {
      out[`title_${lang}`] = seo.title[lang].length;
      out[`description_${lang}`] = seo.description[lang].length;
    }
    return out;
  });

  function submit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      let result;
      try {
        result = await saveSeoSettingsAction(formData);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      setField(result?.ok ? null : result?.field || null);
      setMessage(result?.ok ? { tone: 'success', text: result.message } : { tone: 'error', text: result?.error || t('errors.actionFailed') });
      if (result?.ok) router.refresh();
    });
  }

  const invalid = (name) => (field === name ? 'border-danger' : '');
  const track = (event) => setLengths((prev) => ({ ...prev, [event.target.name]: event.target.value.length }));

  return (
    <form onSubmit={submit} className="space-y-5 rounded-card border border-line bg-white p-4 sm:p-5">
      <div className="grid gap-5 lg:grid-cols-2">
        {SEO_LANGUAGES.map((lang) => (
          <fieldset key={lang} className="space-y-3">
            <legend className="u-micro-strong mb-1 text-ink">{t(`admin.cms.seo.language.${lang}`)}</legend>
            <div>
              <label htmlFor={`seo-title-${lang}`} className={LABEL}>{t('admin.cms.seo.siteNameLabel')}</label>
              <input
                id={`seo-title-${lang}`}
                name={`title_${lang}`}
                defaultValue={seo.title[lang]}
                placeholder={defaults[lang].title}
                maxLength={SEO_TITLE_MAX}
                onChange={track}
                aria-invalid={field === `title_${lang}` || undefined}
                className={`${INPUT} ${invalid(`title_${lang}`)}`}
              />
              <p className="u-micro mt-1 text-ink-45">
                {t('admin.cms.seo.counter', { count: lengths[`title_${lang}`], max: SEO_TITLE_MAX })}
              </p>
            </div>
            <div>
              <label htmlFor={`seo-description-${lang}`} className={LABEL}>{t('admin.cms.seo.descriptionLabel')}</label>
              <textarea
                id={`seo-description-${lang}`}
                name={`description_${lang}`}
                defaultValue={seo.description[lang]}
                placeholder={defaults[lang].description}
                maxLength={SEO_DESCRIPTION_MAX}
                rows={3}
                onChange={track}
                aria-invalid={field === `description_${lang}` || undefined}
                className={`${INPUT} ${invalid(`description_${lang}`)}`}
              />
              <p className="u-micro mt-1 text-ink-45">
                {t('admin.cms.seo.counter', { count: lengths[`description_${lang}`], max: SEO_DESCRIPTION_MAX })}
              </p>
            </div>
          </fieldset>
        ))}
      </div>

      <div>
        <label htmlFor="seo-og-image" className={LABEL}>{t('admin.cms.seo.ogImageLabel')}</label>
        <input
          id="seo-og-image"
          name="og_image_url"
          type="text"
          inputMode="url"
          defaultValue={seo.ogImageUrl}
          placeholder="https://…"
          maxLength={SEO_IMAGE_URL_MAX}
          aria-invalid={field === 'og_image_url' || undefined}
          className={`${INPUT} ${invalid('og_image_url')}`}
        />
        <p className="u-micro mt-1 text-ink-45">{t('admin.cms.seo.ogImageHint')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={BUTTON}>
          <Save strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
          {pending ? t('admin.cms.seo.saving') : t('common.actions.save')}
        </button>
        {message ? (
          <p role={message.tone === 'error' ? 'alert' : 'status'} className={`u-micro ${message.tone === 'error' ? 'text-danger' : 'text-success'}`}>
            {message.text}
          </p>
        ) : null}
        {updatedLabel ? <p className="u-micro text-ink-45">{updatedLabel}</p> : null}
      </div>
    </form>
  );
}
