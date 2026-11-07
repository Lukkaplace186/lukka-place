import { redirect } from 'next/navigation';
import MoveOnboarding from '@/components/MoveOnboarding';
import { getPortalCustomer } from '@/lib/customerPortal';
import { getMoveProject } from '@/lib/moveProjects';
import { answersFromProject } from '@/lib/moveProjectRules';
import { getT } from '@/lib/i18n/server';
import { saveMoveProjectAction } from '../actions';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('account.move.page.metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

/**
 * The same cards as signup, for a customer who has an account: reopened on
 * their stored answers ("Modifier mon projet"), or empty for one who signed
 * up without answering, through WhatsApp, or before this existed
 * (Accueil's "Parlez-nous de votre déménagement").
 */
export default async function EditMoveProjectPage({ searchParams }) {
  const params = await searchParams;
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client/projet/modifier');
  const project = await getMoveProject(session.customerId);
  return (
    <MoveOnboarding
      mode="edit"
      initialAnswers={answersFromProject(project)}
      saveAction={saveMoveProjectAction}
      saveError={params?.error === 'save'}
      startAtEnd={params?.error === 'save'}
    />
  );
}
