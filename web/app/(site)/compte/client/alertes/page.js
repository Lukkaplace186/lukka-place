import { redirect } from 'next/navigation';

/**
 * "Mes alertes" merged into the "Favoris & Alertes" tab (../page.js) behind
 * a `?tab=alertes` sub-toggle. This route stays only so an old bookmark or
 * link still lands somewhere real.
 */
export default function AlertesPage() {
  redirect('/compte/client?tab=alertes');
}
