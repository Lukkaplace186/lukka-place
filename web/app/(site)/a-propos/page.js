import PageShell from '@/components/PageShell';
import { getT } from '@/lib/i18n/server';

/*
 * `generateMetadata`, not a static `metadata` object: a static export is
 * evaluated once at module load and so cannot see the request's locale. The
 * <title> and the share-card description are user-facing copy like any other
 * — an English visitor sharing this page should not put a French card into
 * their WhatsApp thread.
 */
export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('about.metaTitle'),
    description: t('about.metaDescription'),
  };
}

export default async function AboutPage() {
  const t = await getT();

  return (
    <PageShell
      eyebrow={t('about.eyebrow')}
      title={t('about.title')}
      lead={t('about.lead')}
      breadcrumb={[{ label: t('breadcrumb.home'), href: '/' }, { label: t('about.eyebrow') }]}
    >
      <div className="flex flex-col gap-6 text-[0.9375rem] leading-relaxed text-ink-70">
        <p>{t('about.body1')}</p>
        <p>{t('about.body2')}</p>
        <p>{t('about.body3')}</p>
        <p>{t('about.body4')}</p>
      </div>
    </PageShell>
  );
}
