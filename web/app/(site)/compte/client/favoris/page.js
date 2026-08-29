import { redirect } from 'next/navigation';

/**
 * "Mes favoris" merged into the "Favoris & Alertes" tab (../page.js), which
 * is now the portal's default landing view. This route stays only so an old
 * bookmark or link still lands somewhere real.
 */
export default function FavorisPage() {
  redirect('/compte/client');
}
