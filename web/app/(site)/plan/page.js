import PageShell, { PageAction, PageNotice } from '@/components/PageShell';

export const metadata = {
  title: 'Plan — Lukka Place',
  description: 'Outils de planification pour votre recherche immobilière à Kinshasa.',
};

/**
 * Honest stub. The reference portals fill this slot with mortgage
 * calculators and moving tools; there is no financing data and no
 * service-provider integration behind this site, so shipping a calculator
 * would mean inventing the rates it runs on.
 */
export default function PlanPage() {
  return (
    <PageShell
      eyebrow="Plan"
      title="Préparer votre achat ou votre location"
      breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Plan' }]}
    >
      <div className="flex flex-col items-start gap-6">
        <PageNotice>
          Un simulateur de budget demanderait des taux de financement réels, dont Lukka Place ne dispose pas. Plutôt
          qu&apos;un calculateur alimenté par des chiffres inventés, cette page reste vide en attendant des données
          fiables.
        </PageNotice>
        <p className="text-[0.9375rem] leading-relaxed text-ink-70">
          Ce que vous pouvez déjà faire : chaque annonce affiche son prix exact, sa superficie et son prix au mètre
          carré, en dollars comme en francs, sans frais ajoutés par la plateforme.
        </p>
        <PageAction href="/listings">Parcourir les annonces</PageAction>
      </div>
    </PageShell>
  );
}
