import { redirect } from 'next/navigation';
import PageShell, { PageAction, PageNotice } from '@/components/PageShell';
import { getCurrentCustomerId } from '@/lib/customers';

export const metadata = {
  title: 'Actualités — Lukka Place',
  description: 'Alertes sur les nouvelles annonces à Kinshasa.',
};

/**
 * Honest stub for anonymous visitors — real alerts now exist, but they're
 * account-scoped (/compte/alertes), so a logged-in visitor is sent straight
 * there instead of seeing this "not available" notice for a feature that,
 * for them, actually is available. `navItems.js`'s "Actus" entry keeps
 * pointing here unmodified; this redirect is what handles the split.
 */
export default async function UpdatesPage() {
  const customerId = await getCurrentCustomerId();
  if (customerId) redirect('/compte/alertes');

  return <UpdatesStub />;
}

function UpdatesStub() {
  return (
    <PageShell
      eyebrow="Actualités"
      title="Alertes sur les nouvelles annonces"
      breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Actualités' }]}
    >
      <div className="flex flex-col items-start gap-6">
        <PageNotice>
          Les alertes sont réservées aux visiteurs connectés — créez un compte pour voir les nouvelles annonces
          correspondant à vos recherches sauvegardées.
        </PageNotice>
        <p className="text-[0.9375rem] leading-relaxed text-ink-70">
          En attendant, vous pouvez sauvegarder une recherche depuis la page des annonces : elle est conservée sur cet
          appareil et reste accessible depuis vos favoris.
        </p>
        <PageAction href="/compte/inscription?next=/compte/alertes">Créer un compte</PageAction>
      </div>
    </PageShell>
  );
}
