import PageShell, { PageAction, PageNotice } from '@/components/PageShell';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';

export const metadata = {
  title: 'Messages — Lukka Place',
  description: 'Contactez Lukka Place par WhatsApp.',
};

/**
 * The nav's "Messages" destination. Unlike the other two stub tabs this one
 * maps onto something real: there is no in-app inbox, but WhatsApp already
 * is the platform's messaging channel (CLAUDE.md's Lead Routing Rules), so
 * this routes there rather than showing a bare "coming soon".
 */
export default function MessagesPage() {
  const whatsappHref = getCentralWhatsAppHref('Bonjour, je vous contacte depuis lukkaplace.com.');

  return (
    <PageShell
      eyebrow="Messages"
      title="Vos échanges se passent sur WhatsApp"
      lead="Lukka Place n'a pas de messagerie interne. Toutes les conversations sur une annonce se font directement par WhatsApp, sans compte ni formulaire."
      breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Messages' }]}
    >
      {whatsappHref ? (
        <PageAction href={whatsappHref} external tone="green">
          Ouvrir WhatsApp
        </PageAction>
      ) : (
        <PageNotice>
          Le numéro WhatsApp de contact n&apos;est pas encore configuré sur cette installation.
        </PageNotice>
      )}
    </PageShell>
  );
}
