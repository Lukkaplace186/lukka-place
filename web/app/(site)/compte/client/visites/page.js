import { redirect } from 'next/navigation';

/**
 * "Visites planifiées" merged into the "Messages & Visites" tab
 * (../messages/page.js) — a viewing is just a lead whose status is one of
 * VIEWING_REQUESTED/VIEWING_COMPLETED, so it now shows inline in that same
 * chronological thread list instead of a separate timeline page. This route
 * stays only so an old bookmark or link still lands somewhere real.
 */
export default function VisitesPage() {
  redirect('/compte/client/messages');
}
