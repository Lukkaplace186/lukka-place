'use client';

import { useActionState, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { slugify, LIMITS } from '@/lib/blogRules';
import { savePostAction } from './actions';

const INPUT = 'u-micro w-full rounded-lg border border-line bg-surface px-3 text-ink focus:border-blue focus:outline-none';
const LABEL = 'u-micro-strong text-ink';
const HINT = 'u-micro text-ink-45';

/** "2026-10-26T09:30" in Kinshasa time, for a datetime-local field. */
function kinshasaLocal(iso) {
  if (!iso) return '';
  const date = new Date(new Date(iso).getTime() + 60 * 60 * 1000);
  return date.toISOString().slice(0, 16);
}

function Field({ label, hint, error, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={LABEL}>{label}</span>
      {children}
      {hint ? <span className={HINT}>{hint}</span> : null}
      {error ? <span className="u-micro-strong text-danger">{error}</span> : null}
    </label>
  );
}

function Counter({ value, max }) {
  return (
    <span className={`u-micro u-tabular self-end ${value.length > max ? 'text-danger' : 'text-ink-45'}`}>
      {value.length} / {max}
    </span>
  );
}

/**
 * The /admin/blog editor, for a new post (`post` null) or an existing one.
 * One form, one Server Action (savePostAction), which re-validates
 * everything; nothing here is trusted. Option lists come from the server
 * (communes from lib/cities.js, types from the landing pages' list) so the
 * labels need no extra dictionary in the console.
 */
export default function PostEditor({ post, communeGroups, typeOptions }) {
  const t = useT();
  const [state, formAction, pending] = useActionState(savePostAction, null);
  const [title, setTitle] = useState(post?.title_fr || '');
  const [slug, setSlug] = useState(post?.slug || '');
  const [slugEdited, setSlugEdited] = useState(Boolean(post));
  const [summary, setSummary] = useState(post?.summary_fr || '');
  const [status, setStatus] = useState(post?.status || 'draft');
  const [showEnglish, setShowEnglish] = useState(Boolean(post?.title_en));
  const fieldError = (name) => (state && !state.ok && state.field === name ? state.error : null);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {post ? <input type="hidden" name="id" value={post.id} /> : null}

      {state?.ok ? (
        <p className="u-micro-strong rounded-lg bg-success-tint px-3.5 py-2.5 text-success" role="status">{state.message}</p>
      ) : null}
      {state && !state.ok ? (
        <p className="u-micro-strong rounded-lg bg-danger-tint px-3.5 py-2.5 text-danger" role="alert">{state.error}</p>
      ) : null}

      <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-5">
        <h2 className="u-title-card text-ink">{t('admin.blog.sectionText')}</h2>
        <Field label={t('admin.blog.titleFr')} error={fieldError('title_fr')}>
          <input
            name="title_fr"
            required
            maxLength={LIMITS.title}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!slugEdited) setSlug(slugify(e.target.value));
            }}
            className={`${INPUT} h-10`}
          />
        </Field>
        <Field label={t('admin.blog.slug')} hint={t('admin.blog.slugHint', { slug: slug || '…' })} error={fieldError('slug')}>
          <input
            name="slug"
            maxLength={LIMITS.slug}
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugEdited(true);
            }}
            className={`${INPUT} h-10 font-mono`}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('admin.blog.category')}>
            <select name="category" defaultValue={post?.category || 'actualite'} className={`${INPUT} h-10`}>
              <option value="actualite">{t('admin.blog.categoryNews')}</option>
              <option value="guide">{t('admin.blog.categoryGuide')}</option>
            </select>
          </Field>
        </div>
        <Field label={t('admin.blog.summaryFr')} hint={t('admin.blog.summaryHint')} error={fieldError('summary_fr')}>
          <textarea
            name="summary_fr"
            rows={2}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className={`${INPUT} py-2`}
          />
          <Counter value={summary} max={LIMITS.summary} />
        </Field>
        <Field label={t('admin.blog.bodyFr')} error={fieldError('body_fr')}>
          <textarea name="body_fr" rows={18} defaultValue={post?.body_fr || ''} className={`${INPUT} py-2 font-mono text-[0.8125rem] leading-relaxed`} />
        </Field>
        <details className="rounded-lg bg-canvas-alt px-3.5 py-2.5">
          <summary className="u-micro-strong cursor-pointer text-ink">{t('admin.blog.formatHelpTitle')}</summary>
          <pre className="u-micro mt-2 whitespace-pre-wrap font-mono text-ink-70">{t('admin.blog.formatHelp')}</pre>
        </details>
      </section>

      <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-5">
        <h2 className="u-title-card text-ink">{t('admin.blog.sectionCover')}</h2>
        {post?.cover_url ? (
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- console thumbnail */}
            <img src={post.cover_url} alt="" className="h-20 w-32 rounded-md object-cover" />
            <label className="u-micro flex items-center gap-2 text-ink-70">
              <input type="checkbox" name="remove_cover" /> {t('admin.blog.removeCover')}
            </label>
          </div>
        ) : null}
        <Field label={post?.cover_url ? t('admin.blog.replaceCover') : t('admin.blog.cover')} hint={t('admin.blog.coverHint')} error={fieldError('cover')}>
          <input type="file" name="cover" accept="image/jpeg,image/png,image/webp" className="u-micro" />
        </Field>
        <Field label={t('admin.blog.coverAlt')} hint={t('admin.blog.coverAltHint')} error={fieldError('cover_alt')}>
          <input name="cover_alt" maxLength={LIMITS.alt} defaultValue={post?.cover_alt || ''} className={`${INPUT} h-10`} />
        </Field>
      </section>

      <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-5">
        <div>
          <h2 className="u-title-card text-ink">{t('admin.blog.sectionAbout')}</h2>
          <p className={`${HINT} mt-1`}>{t('admin.blog.aboutHint')}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('admin.blog.purpose')}>
            <select name="purpose" defaultValue={post?.purpose || ''} className={`${INPUT} h-10`}>
              <option value="">{t('admin.blog.none')}</option>
              <option value="location">{t('admin.blog.purposeRent')}</option>
              <option value="vente">{t('admin.blog.purposeSale')}</option>
            </select>
          </Field>
          <Field label={t('admin.blog.commune')} error={fieldError('commune')}>
            <select name="commune" defaultValue={post?.commune || ''} className={`${INPUT} h-10`}>
              <option value="">{t('admin.blog.none')}</option>
              {communeGroups.map((group) => (
                <optgroup key={group.city} label={group.city}>
                  {group.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label={t('admin.blog.propertyType')} error={fieldError('property_type')}>
            <select name="property_type" defaultValue={post?.property_type || ''} className={`${INPUT} h-10`}>
              <option value="">{t('admin.blog.none')}</option>
              {typeOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:p-5">
        <button type="button" onClick={() => setShowEnglish((v) => !v)} className="u-title-card self-start text-left text-ink">
          {showEnglish ? '▾' : '▸'} {t('admin.blog.sectionEnglish')}
        </button>
        <p className={HINT}>{t('admin.blog.englishHint')}</p>
        <div className={showEnglish ? 'flex flex-col gap-4' : 'hidden'}>
          <Field label={t('admin.blog.titleEn')} error={fieldError('title_en')}>
            <input name="title_en" maxLength={LIMITS.title} defaultValue={post?.title_en || ''} className={`${INPUT} h-10`} />
          </Field>
          <Field label={t('admin.blog.summaryEn')}>
            <textarea name="summary_en" rows={2} maxLength={LIMITS.summary} defaultValue={post?.summary_en || ''} className={`${INPUT} py-2`} />
          </Field>
          <Field label={t('admin.blog.bodyEn')}>
            <textarea name="body_en" rows={12} defaultValue={post?.body_en || ''} className={`${INPUT} py-2 font-mono text-[0.8125rem] leading-relaxed`} />
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-5">
        <h2 className="u-title-card text-ink">{t('admin.blog.sectionPublish')}</h2>
        <div className="flex flex-wrap gap-4">
          {['draft', 'published'].map((value) => (
            <label key={value} className="u-micro flex items-center gap-2 text-ink">
              <input type="radio" name="status" value={value} checked={status === value} onChange={() => setStatus(value)} />
              {value === 'draft' ? t('admin.blog.statusDraft') : t('admin.blog.statusPublish')}
            </label>
          ))}
        </div>
        {status === 'published' ? (
          <Field label={t('admin.blog.publishedAt')} hint={t('admin.blog.publishedAtHint')} error={fieldError('published_at')}>
            <input type="datetime-local" name="published_at" defaultValue={kinshasaLocal(post?.published_at)} className={`${INPUT} h-10 sm:max-w-xs`} />
          </Field>
        ) : (
          <input type="hidden" name="published_at" value={kinshasaLocal(post?.published_at)} />
        )}
        <p className={HINT}>{t('admin.blog.visibilityNote')}</p>
        <div>
          <button
            type="submit"
            disabled={pending}
            className="u-press inline-flex h-10 items-center rounded-lg bg-blue px-5 text-sm font-bold text-white hover:bg-blue-deep disabled:opacity-60"
          >
            {pending ? t('admin.blog.saving') : t('admin.blog.save')}
          </button>
        </div>
      </section>
    </form>
  );
}
