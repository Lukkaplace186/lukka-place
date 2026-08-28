import PageShell, { PageAction, PageNotice } from '@/components/PageShell';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';

export const metadata = {
  title: 'Contact — Lukka Place',
  description: 'Contactez Lukka Place par WhatsApp.',
};

export default function ContactPage() {
  const whatsappHref = getCentralWhatsAppHref('Bonjour, je vous contacte depuis lukkaplace.com.');

  return (
    <PageShell
      eyebrow="Contact"
      title="Parlons de votre projet"
      lead="WhatsApp est le moyen le plus rapide de nous joindre — une question sur une annonce, un bien à soumettre, ou toute autre demande."
      breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Contact' }]}
    >
      {whatsappHref ? (
        <PageAction href={whatsappHref} external tone="green">
          Écrire sur WhatsApp
        </PageAction>
      ) : (
        <PageNotice>
          Le numéro WhatsApp de contact n&apos;est pas encore configuré sur cette installation.
        </PageNotice>
      )}
    </PageShell>
  );
}
