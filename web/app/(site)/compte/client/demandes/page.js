import { redirect } from 'next/navigation';
import { getPortalCustomer } from '@/lib/customerPortal';
import { moveRequestHref } from '@/lib/moveRequestHref';

export const dynamic = 'force-dynamic';

/**
 * "Trouver pour moi" in the account (2026-11-08, owner request): there is one
 * way to ask the agencies now, the move project ("Envoyer ma demande aux
 * agences"). This page used to hold a second request form that asked again
 * what the project already knew. Every link to it (header, Accueil, Activité,
 * /agents, /a-propos, the empty search) now lands on the newest open project's
 * request section, or on a new project — lib/moveRequestHref.js. The old form
 * (RequestForm.js, submitPropertyRequestAction) is kept, unused, for history.
 */
export default async function DemandesPage() {
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client/demandes');
  redirect(await moveRequestHref(session.customerId));
}
