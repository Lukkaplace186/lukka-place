import { redirect } from 'next/navigation';

/**
 * Visites is now a tab inside Demandes (../demandes/page.js's VisitsTab) —
 * a viewing request is one stage of the same client conversation, not a
 * second inbox, and the customer portal made the same merge on its own side
 * (compte/client/visites redirects into Messages & Visites).
 *
 * This route stays so an existing bookmark, or a notification link sent
 * before the merge, still lands on the real thing rather than a 404.
 */
export default function AgentVisitsPage() {
  redirect('/compte/agent/demandes?tab=visites');
}
