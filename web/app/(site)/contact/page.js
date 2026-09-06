import PageShell, { PageAction, PageNotice } from '@/components/PageShell';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { getT } from '@/lib/i18n/server';

// See /a-propos on why this is generateMetadata rather than a static object.
export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('contact.metaTitle'),
    description: t('contact.metaDescription'),
  };
}

export default async function ContactPage() {
  const t = await getT();
  // The prefilled WhatsApp greeting follows the visitor's language too.
  const whatsappHref = getCentralWhatsAppHref(t('footer.whatsappGreeting'));

  return (
    <PageShell
      eyebrow={t('contact.eyebrow')}
      title={t('contact.title')}
      lead={t('contact.lead')}
      breadcrumb={[{ label: t('breadcrumb.home'), href: '/' }, { label: t('contact.eyebrow') }]}
    >
      {whatsappHref ? (
        <PageAction href={whatsappHref} external tone="green">
          {t('contact.whatsappCta')}
        </PageAction>
      ) : (
        <PageNotice>
          {t('contact.unavailable')}
        </PageNotice>
      )}
    </PageShell>
  );
}
