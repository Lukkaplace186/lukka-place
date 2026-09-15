import { PortalBoardSkeleton } from '@/components/PortalSkeleton';
import { getT } from '@/lib/i18n/server';

/** Shown under the portal's tab bar while a tab's page renders — see components/PortalSkeleton.js. */
export default async function ClientPortalLoading() {
  const t = await getT();
  return <PortalBoardSkeleton label={t('account.portal.loading')} />;
}
