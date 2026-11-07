import { redirect } from 'next/navigation';
import { getPortalCustomer } from '@/lib/customerPortal';
import { listMoveProjects } from '@/lib/moveProjects';

export const dynamic = 'force-dynamic';

/**
 * The single-project edit link from before several projects existed
 * (2026-11-07, live for a few hours): the customer's first project's edit
 * page, or a new project when they have none.
 */
export default async function LegacyEditMoveProject() {
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client/projet');
  const [first] = await listMoveProjects(session.customerId);
  redirect(first ? `/compte/client/projet/${first.id}/modifier` : '/compte/client/projet/nouveau');
}
