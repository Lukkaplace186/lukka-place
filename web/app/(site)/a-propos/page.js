import PageShell from '@/components/PageShell';

export const metadata = {
  title: 'À propos — Lukka Place',
  description: "Comment fonctionne Lukka Place, la plateforme d'annonces immobilières de Kinshasa.",
};

export default function AboutPage() {
  return (
    <PageShell
      eyebrow="À propos"
      title="Une plateforme faite pour Kinshasa"
      lead="Les agents et particuliers soumettent leurs biens par WhatsApp. Chaque annonce est structurée, vérifiée, puis publiée."
      breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'À propos' }]}
    >
      <div className="flex flex-col gap-6 text-[0.9375rem] leading-relaxed text-ink-70">
        <p>
          Lukka Place est une plateforme d&apos;annonces immobilières dédiée à Kinshasa. Les agents et particuliers
          soumettent leurs biens directement par WhatsApp — texte ou photos — et chaque annonce est structurée puis
          vérifiée avant d&apos;être publiée sur le site.
        </p>
        <p>
          L&apos;objectif est simple : donner aux personnes qui cherchent un appartement, une villa ou une parcelle à
          Kinshasa un endroit unique, à jour, où chaque annonce correspond à un bien réellement disponible — et un moyen
          direct de contacter au sujet d&apos;un bien, sans compte ni formulaire.
        </p>
        <p>
          Les prix sont établis en dollars américains. L&apos;affichage en francs congolais est une estimation
          indicative, convertie à un taux de référence daté et mis à jour manuellement, jamais présentée comme le prix
          contractuel.
        </p>
        <p>
          Lukka Place ne fournit pas de services de courtage financier direct ; la plateforme facilite la mise en
          relation entre les annonceurs et les personnes intéressées via référence d&apos;annonce.
        </p>
      </div>
    </PageShell>
  );
}
