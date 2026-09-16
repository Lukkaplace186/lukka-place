'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ImageUp, RotateCcw, Save } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { HERO_ALT_MAX, HERO_CREDIT_MAX, HERO_UPLOAD_TYPES, allowedHeroUrl } from '@/lib/cmsHeroRules';
import builtInHero from '../../../Hero/hero-sunlit.jpg';
import { saveHeroAction } from './actions';

const INPUT = 'u-micro h-9 w-full rounded-lg border border-line bg-surface px-3 text-ink focus:border-blue focus:outline-none';
const BUTTON = 'u-press u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-ink hover:border-blue disabled:opacity-50';

/**
 * "Gestion visuelle" — the homepage hero picture. The preview is drawn the way
 * components/Hero.js draws the band (photo, white headline with the same
 * shadow), from the file picked or the URL pasted, before anything is saved.
 * Saving is live on lukkaplace.com at the next page load.
 */
export default function HeroManager({ current, updatedLabel, headline, subheadline }) {
  const t = useT();
  const router = useRouter();
  const formRef = useRef(null);
  const [pending, startTransition] = useTransition();
  const [fileUrl, setFileUrl] = useState(null);
  const [pastedUrl, setPastedUrl] = useState('');
  const [message, setMessage] = useState(null);

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  const pastedValid = pastedUrl ? allowedHeroUrl(pastedUrl) : null;
  const previewSrc = fileUrl || pastedValid || current?.imageUrl || builtInHero.src;
  const isBuiltIn = !fileUrl && !pastedValid && !current?.imageUrl;

  function onFile(event) {
    const file = event.target.files?.[0];
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFileUrl(file ? URL.createObjectURL(file) : null);
    if (file) setPastedUrl('');
  }

  function submit(reset) {
    const formData = new FormData(formRef.current);
    if (reset) formData.set('reset', '1');
    startTransition(async () => {
      let result;
      try {
        result = await saveHeroAction(formData);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      setMessage(result?.ok ? { tone: 'success', text: result.message } : { tone: 'error', text: result?.error || t('errors.actionFailed') });
      if (result?.ok) {
        formRef.current?.reset();
        setFileUrl(null);
        setPastedUrl('');
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-4 rounded-card border border-line bg-white p-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div>
        <div className="u-eyebrow mb-2 text-ink-45">{t('admin.cms.hero.preview')}</div>
        <div className="relative aspect-[16/7] w-full overflow-hidden rounded-lg bg-ink">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of an unsaved file or URL */}
          <img src={previewSrc} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="relative flex h-full flex-col justify-center p-5">
            <p className="max-w-[80%] text-xl font-extrabold leading-tight text-white [text-shadow:0_1px_3px_rgb(0_0_0_/_0.75),0_6px_24px_rgb(0_0_0_/_0.55)] sm:text-2xl">
              {headline}
            </p>
            <p className="mt-1 max-w-[70%] text-xs font-bold text-white [text-shadow:0_1px_3px_rgb(0_0_0_/_0.8)]">{subheadline}</p>
          </div>
          <div className="absolute inset-x-5 bottom-0 h-6 rounded-t-lg bg-white/95" aria-hidden="true" />
        </div>
        <p className="u-micro mt-2 text-ink-45">
          {isBuiltIn ? t('admin.cms.hero.usingBuiltIn') : fileUrl || pastedValid ? t('admin.cms.hero.unsaved') : updatedLabel}
        </p>
      </div>

      <form
        ref={formRef}
        onSubmit={(event) => { event.preventDefault(); submit(false); }}
        className="flex flex-col gap-3"
      >
        <label className="flex flex-col gap-1">
          <span className="u-micro-strong text-ink">{t('admin.cms.hero.upload')}</span>
          <input
            type="file"
            name="image"
            accept={Object.keys(HERO_UPLOAD_TYPES).join(',')}
            onChange={onFile}
            className="u-micro text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-ink"
          />
          <span className="u-micro text-ink-45">{t('admin.cms.hero.uploadHint')}</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="u-micro-strong text-ink">{t('admin.cms.hero.orUrl')}</span>
          <input
            name="image_url"
            type="url"
            inputMode="url"
            value={pastedUrl}
            disabled={Boolean(fileUrl)}
            onChange={(event) => setPastedUrl(event.target.value)}
            placeholder="https://havyrzfdksabghgbrxfy.supabase.co/storage/v1/object/public/…"
            className={INPUT}
          />
          {pastedUrl && !pastedValid ? <span className="u-micro text-danger">{t('admin.cms.hero.badUrl')}</span> : null}
        </label>
        <label className="flex flex-col gap-1">
          <span className="u-micro-strong text-ink">{t('admin.cms.hero.alt')}</span>
          <input name="alt" maxLength={HERO_ALT_MAX} defaultValue={current?.alt || ''} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="u-micro-strong text-ink">{t('admin.cms.hero.credit')}</span>
          <input name="credit" maxLength={HERO_CREDIT_MAX} defaultValue={current?.credit || ''} placeholder={t('admin.cms.hero.creditPlaceholder')} className={INPUT} />
          <span className="u-micro text-ink-45">{t('admin.cms.hero.creditHint')}</span>
        </label>
        {message ? (
          <p role="status" className={`u-micro ${message.tone === 'error' ? 'text-danger' : 'text-success'}`}>{message.text}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={`${BUTTON} border-blue text-blue-deep`} disabled={pending || (!fileUrl && !pastedValid && !current?.imageUrl)}>
            {fileUrl ? <ImageUp strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" /> : <Save strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />}
            {t('admin.cms.hero.save')}
          </button>
          {current?.imageUrl ? (
            <button type="button" className={BUTTON} disabled={pending} onClick={() => submit(true)}>
              <RotateCcw strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('admin.cms.hero.reset')}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
