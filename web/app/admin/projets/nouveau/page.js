import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import ProjectDetailsForm from '../ProjectDetailsForm';
import { createProjectAction } from '../actions';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('admin.projects.new'), robots: { index: false, follow: false } };
}

export default async function NewProjectPage({ searchParams }) {
  const t = await getT();
  const sp = await searchParams;
  const error = typeof sp.error === 'string' ? sp.error : null;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <Link href="/admin/projets" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-70 hover:text-ink">
        <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        {t('admin.projects.back')}
      </Link>
      <div>
        <h1 className="u-title-page text-ink">{t('admin.projects.new')}</h1>
        <p className="u-micro mt-1 text-ink-70">{t('admin.projects.newIntro')}</p>
      </div>
      {error ? <p className="rounded-lg bg-danger-tint px-4 py-2 text-sm font-semibold text-danger" role="alert">{t(`admin.projects.errors.${error}`)}</p> : null}
      <section className="rounded-card border border-line bg-surface p-5 sm:p-6">
        <ProjectDetailsForm action={createProjectAction} submitLabel={t('admin.projects.createDraft')} />
      </section>
    </div>
  );
}
