import PageShell, { PageAction, PageNotice } from '@/components/PageShell';
import { getT } from '@/lib/i18n/server';

// generateMetadata, not a static object: a static export is evaluated at
// module load, where there is no request and so no translator.
export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('updates.planMetaTitle'),
    description: t('updates.planMetaDescription'),
  };
}

/**
 * Honest stub. The reference portals fill this slot with mortgage
 * calculators and moving tools; there is no financing data and no
 * service-provider integration behind this site, so shipping a calculator
 * would mean inventing the rates it runs on.
 */
export default async function PlanPage() {
  const t = await getT();
  return (
    <PageShell
      eyebrow="Plan"
      title={t('updates.planTitle')}
      breadcrumb={[{ label: t('breadcrumb.home'), href: '/' }, { label: 'Plan' }]}
    >
      <div className="flex flex-col items-start gap-6">
        <PageNotice>
          {t('updates.planBody1')}
          qu&apos;un calculateur alimenté par des chiffres inventés, cette page reste vide en attendant des données
          fiables.
        </PageNotice>
        <p className="text-[0.9375rem] leading-relaxed text-ink-70">
          {t('updates.planBody2')}
        </p>
        <PageAction href="/listings">{t('account.favorites.browseListings')}</PageAction>
      </div>
    </PageShell>
  );
}
