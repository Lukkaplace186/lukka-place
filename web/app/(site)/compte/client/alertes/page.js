import { redirect } from 'next/navigation';

/**
 * "Mes alertes" lives on Enregistrés (../favoris/page.js) behind a
 * `?tab=alertes` switch. This route stays so an old bookmark still lands.
 */
export default function AlertesPage() {
  redirect('/compte/client/favoris?tab=alertes');
}
