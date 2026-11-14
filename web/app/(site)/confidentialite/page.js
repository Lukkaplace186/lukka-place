import Link from 'next/link';
import { getLocale } from '@/lib/i18n/server';
import { privacyPolicyFor } from '@/lib/legal/privacyPolicy';
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP_DISPLAY } from '@/lib/legal/contact';

/**
 * /confidentialite — the privacy policy, and the "Privacy Policy URL" given to
 * Google Play and the App Store. The text lives in lib/legal/privacyPolicy.js
 * (French and English inline, like /conditions and /guides); this file only
 * lays it out. `#suppression` is the stores' account-deletion link.
 */

export async function generateMetadata() {
  const copy = privacyPolicyFor(await getLocale());
  return {
    title: `${copy.title} — Lukka Place`,
    description: copy.intro,
    alternates: { canonical: '/confidentialite' },
  };
}

// A full-height row on a phone: these are tapped with a thumb in the app.
const TOC_LINK = 'u-micro block py-2 text-ink-70 transition-colors hover:text-blue-deep sm:py-1';
const LINK = 'font-semibold text-blue-deep underline underline-offset-2';

export default async function PrivacyPage() {
  const copy = privacyPolicyFor(await getLocale());
  const whatsappHref = `https://wa.me/${SUPPORT_WHATSAPP_DISPLAY.replace(/\D/g, '')}`;
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="u-title-hero text-ink">{copy.title}</h1>
      <p className="u-micro mt-2 text-ink-45">{copy.updated}</p>
      <p className="u-body mt-5 text-ink-70">{copy.intro}</p>

      <nav aria-label={copy.contents} className="mt-8">
        <h2 className="u-eyebrow">{copy.contents}</h2>
        <ol className="mt-2">
          {copy.sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className={TOC_LINK}>
                {section.title}
              </a>
            </li>
          ))}
          <li>
            <a href="#contact" className={TOC_LINK}>{copy.contact.title}</a>
          </li>
        </ol>
      </nav>

      {copy.sections.map((section) => (
        <section key={section.id} id={section.id} className="mt-10 scroll-mt-24">
          <h2 className="u-title-section text-ink">{section.title}</h2>
          {section.paragraphs.map((text, index) => (
            <p key={index} className="u-body mt-3 text-ink-70">{text}</p>
          ))}
        </section>
      ))}

      <section id="contact" className="mt-10 scroll-mt-24">
        <h2 className="u-title-section text-ink">{copy.contact.title}</h2>
        <p className="u-body mt-3 text-ink-70">{copy.contact.text}</p>
        <ul className="mt-3 space-y-2">
          <li className="u-body text-ink-70">
            {copy.contact.email} : <a href={`mailto:${SUPPORT_EMAIL}`} className={LINK}>{SUPPORT_EMAIL}</a>
          </li>
          <li className="u-body text-ink-70">
            {copy.contact.whatsapp} :{' '}
            <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={`${LINK} u-tabular`}>{SUPPORT_WHATSAPP_DISPLAY}</a>
          </li>
          <li className="u-body"><Link href="/contact" className={LINK}>{copy.contact.page}</Link></li>
          <li className="u-body"><Link href="/conditions" className={LINK}>{copy.contact.terms}</Link></li>
        </ul>
      </section>
    </article>
  );
}
