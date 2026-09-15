import { PortalFormSkeleton } from '@/components/PortalSkeleton';
import { getT } from '@/lib/i18n/server';

export default async function ParametresLoading() {
  const t = await getT();
  return <PortalFormSkeleton label={t('account.portal.loading')} />;
}
