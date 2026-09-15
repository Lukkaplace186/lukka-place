import { PortalInboxSkeleton } from '@/components/PortalSkeleton';
import { getT } from '@/lib/i18n/server';

export default async function MessagesLoading() {
  const t = await getT();
  return <PortalInboxSkeleton label={t('account.portal.loading')} />;
}
