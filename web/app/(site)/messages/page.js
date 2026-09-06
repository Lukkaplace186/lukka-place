import PageShell, { PageAction, PageNotice } from '@/components/PageShell';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { getT } from '@/lib/i18n/server';

// generateMetadata, not a static object: a static export is evaluated at
// module load, where there is no request and so no translator.
export async function generateMetadata() {
  const t = await getT();
  return {
    title: 'Messages — Lukka Place',
    description: t('contact.metaDescription'),
  };
}

/**
 * The nav's "Messages" destination. Unlike the other two stub tabs this one
 * maps onto something real: there is no in-app inbox, but WhatsApp already
 * is the platform's messaging channel (CLAUDE.md's Lead Routing Rules), so
 * this routes there rather than showing a bare "coming soon".
 */
export default async function MessagesPage() {
  const t = await getT();
  const whatsappHref = getCentralWhatsAppHref('Bonjour, je vous contacte depuis lukkaplace.com.');

  return (
    <PageShell
      eyebrow="Messages"
      title={t('updates.messagesTitle')}
      lead={t('updates.messagesLead')}
      breadcrumb={[{ label: t('breadcrumb.home'), href: '/' }, { label: 'Messages' }]}
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
