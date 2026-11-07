import { notFound, redirect } from 'next/navigation';
import MoveOnboarding from '@/components/MoveOnboarding';
import { getPortalCustomer } from '@/lib/customerPortal';
import { getMoveProject } from '@/lib/moveProjects';
import { answersFromProject } from '@/lib/moveProjectRules';
import { getT } from '@/lib/i18n/server';
import { saveMoveProjectAction } from '../../actions';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('account.move.page.metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

/**
 * "Modifier mon projet": the same five cards as signup, reopened on one of
 * the customer's own projects (another customer's id is a 404). Saving
 * replaces every answer, and the name, of that project only.
 */
export default async function EditMoveProjectPage({ params: routeParams, searchParams }) {
  const [{ id }, params] = await Promise.all([routeParams, searchParams]);
  const session = await getPortalCustomer();
  if (!session) redirect(`/compte/connexion?next=/compte/client/projet/${encodeURIComponent(id)}/modifier`);
  const project = await getMoveProject(session.customerId, id);
  if (!project) notFound();
  return (
    <MoveOnboarding
      mode="edit"
      projectId={project.id}
      initialTitle={project.title || ''}
      initialAnswers={answersFromProject(project)}
      saveAction={saveMoveProjectAction}
      saveError={params?.error === 'save'}
      startAtEnd={params?.error === 'save'}
    />
  );
}
