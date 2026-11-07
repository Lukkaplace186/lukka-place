import { redirect } from 'next/navigation';
import MoveOnboarding from '@/components/MoveOnboarding';
import { getPortalCustomer } from '@/lib/customerPortal';
import { listMoveProjects } from '@/lib/moveProjects';
import { MAX_MOVE_PROJECTS } from '@/lib/moveProjectRules';
import { getT } from '@/lib/i18n/server';
import { saveMoveProjectAction } from '../actions';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('account.move.page.metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

/**
 * A new move project for a customer who has an account (up to five): the
 * same cards, empty. At five, back to the list, which says why. The save
 * re-checks the ceiling in SQL, so two tabs cannot make a sixth.
 */
export default async function NewMoveProjectPage({ searchParams }) {
  const params = await searchParams;
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client/projet/nouveau');
  const projects = await listMoveProjects(session.customerId);
  if (projects.length >= MAX_MOVE_PROJECTS) redirect('/compte/client/projet?limite=1');
  return (
    <MoveOnboarding
      mode="edit"
      saveAction={saveMoveProjectAction}
      saveError={params?.error === 'save'}
    />
  );
}
