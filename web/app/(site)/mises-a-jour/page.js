import { redirect } from 'next/navigation';
import PageShell, { PageAction, PageNotice } from '@/components/PageShell';
import { getCurrentCustomerId } from '@/lib/customers';
import { getT } from '@/lib/i18n/server';

// generateMetadata, not a static object: a static export cannot see the
// request locale — see app/(site)/a-propos/page.js.
export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('updates.metaTitle'),
    description: t('updates.metaDescription'),
  };
}

/**
 * Honest stub for anonymous visitors — real alerts now exist, but they're
 * account-scoped (/compte/alertes), so a logged-in visitor is sent straight
 * there instead of seeing this "not available" notice for a feature that,
 * for them, actually is available. `navItems.js`'s "Actus" entry keeps
 * pointing here unmodified; this redirect is what handles the split.
 */
export default async function UpdatesPage() {
  const t = await getT();
  const customerId = await getCurrentCustomerId();
  if (customerId) redirect('/compte/alertes');

  return <UpdatesStub />;
}

async function UpdatesStub() {
  const t = await getT();
  return (
    <PageShell
      eyebrow={t('updates.title')}
      title={t('updates.alertsTitle')}
      breadcrumb={[{ label: t('breadcrumb.home'), href: '/' }, { label: t('updates.title') }]}
    >
      <div className="flex flex-col items-start gap-6">
        <PageNotice>
          {t('updates.alertsSignedInOnly')}
        </PageNotice>
        <p className="text-[0.9375rem] leading-relaxed text-ink-70">
          {t('updates.saveSearchMeanwhile')}
        </p>
        <PageAction href="/compte/inscription?next=/compte/alertes">{t('common.actions.signup')}</PageAction>
      </div>
    </PageShell>
  );
}
