import Link from 'next/link';
import PageShell, { PageAction, PageNotice } from '@/components/PageShell';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { getT, localizedAlternates } from '@/lib/i18n/server';
import { SUPPORT_EMAIL } from '@/lib/legal/contact';

// See /a-propos on why this is generateMetadata rather than a static object.
export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('contact.metaTitle'),
    description: t('contact.metaDescription'),
    alternates: await localizedAlternates('/contact'),
  };
}

/**
 * /contact — also the "Support URL" given to Google Play and the App Store
 * (2026-11-14): the two ways to reach us (WhatsApp, and the e-mail address of
 * the terms, lib/legal/contact.js) and where an account is deleted. No
 * opening hours or answer time is stated: none has been decided.
 */
export default async function ContactPage() {
  const t = await getT();
  // The prefilled WhatsApp greeting follows the visitor's language too.
  const whatsappHref = getCentralWhatsAppHref(t('footer.whatsappGreeting'));
  const links = [
    { href: '/confidentialite#suppression', label: t('contact.linkDelete') },
    { href: '/confidentialite', label: t('contact.linkPrivacy') },
    { href: '/conditions', label: t('contact.linkTerms') },
  ];

  return (
    <PageShell
      eyebrow={t('contact.eyebrow')}
      title={t('contact.title')}
      lead={t('contact.lead')}
      breadcrumb={[{ label: t('breadcrumb.home'), href: '/' }, { label: t('contact.eyebrow') }]}
    >
      <div className="flex flex-wrap gap-3">
        {whatsappHref ? (
          <PageAction href={whatsappHref} external tone="green">
            {t('contact.whatsappCta')}
          </PageAction>
        ) : null}
        <PageAction href={`mailto:${SUPPORT_EMAIL}`}>{t('contact.emailCta')}</PageAction>
      </div>
      <p className="u-micro mt-4 text-ink-45">{t('contact.emailLine', { email: SUPPORT_EMAIL })}</p>
      {whatsappHref ? null : (
        <div className="mt-6">
          <PageNotice>{t('contact.unavailable')}</PageNotice>
        </div>
      )}

      <section className="mt-12 border-t border-line pt-8">
        <h2 className="u-title-card text-ink">{t('contact.accountTitle')}</h2>
        <p className="u-body mt-2 text-ink-70">{t('contact.accountText')}</p>
        <ul className="mt-3">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="inline-flex min-h-11 items-center text-[0.9375rem] font-semibold text-blue-deep underline underline-offset-2"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}
