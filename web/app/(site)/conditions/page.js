import Link from 'next/link';
import { getLocale } from '@/lib/i18n/server';
import { TERMS_ARTICLES_FR, TERMS_EFFECTIVE, TERMS_SUMMARY_FR, TERMS_VERSION } from '@/lib/legal/termsFr';

/**
 * /conditions — Conditions Générales d'Utilisation et Avertissement, the
 * owner's own legal text (lib/legal/termsFr.js, copied word for word).
 * Reached from a small link beside the footer's copyright line.
 *
 * The articles are always shown in French: article 18 makes the French
 * version the one that counts, and a translation we wrote would be a second
 * legal text nobody approved. An English reader gets the page chrome and the
 * "in brief" box in English, with a line saying so, then the French articles.
 */

const CHROME = {
  fr: {
    title: "Conditions générales d'utilisation et avertissement",
    meta: `Version ${TERMS_VERSION} — en vigueur à compter du ${TERMS_EFFECTIVE}.`,
    briefTitle: "L'essentiel en bref",
    brief: TERMS_SUMMARY_FR,
    languageNote: null,
    contents: 'Sommaire',
    privacy: 'Voir aussi : Confidentialité et mesure d’audience',
  },
  en: {
    title: 'Terms of Use and Disclaimer',
    meta: `Version ${TERMS_VERSION}, in force from 5 November 2026.`,
    briefTitle: 'In Brief',
    brief: [
      'LukkaPlace publishes property listings: we are not an owner or an agency, and we are not a party to any rental or sale contract.',
      'Listings are published under their authors’ responsibility. Always check the property and its documents before paying anything.',
      'Never pay for a property, a deposit or an advance without visiting it and identifying the owner.',
      'Any automated or systematic extraction of LukkaPlace data (scraping) is strictly forbidden, without exception.',
      'By using LukkaPlace, you accept these terms.',
    ],
    languageNote: 'The terms below are in French. The French version is the only one that is legally binding (article 18).',
    contents: 'Contents',
    privacy: 'See also: Privacy and Audience Measurement',
  },
};

function articleId(article, index) {
  return article.id || `article-${index + 1}`;
}

export async function generateMetadata() {
  const locale = await getLocale();
  return {
    title: `${CHROME[locale === 'en' ? 'en' : 'fr'].title} — Lukka Place`,
    alternates: { canonical: '/conditions' },
  };
}

export default async function TermsPage() {
  const locale = await getLocale();
  const copy = CHROME[locale === 'en' ? 'en' : 'fr'];
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="u-title-hero text-ink">{copy.title}</h1>
      <p className="u-micro mt-2 text-ink-45">{copy.meta}</p>

      <section className="mt-8 rounded-lg border border-line bg-surface p-5">
        <h2 className="u-title-card text-ink">{copy.briefTitle}</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          {copy.brief.map((line) => (
            <li key={line.slice(0, 40)} className="u-body text-ink-70">{line}</li>
          ))}
        </ul>
      </section>

      {copy.languageNote ? <p className="u-micro mt-6 text-ink-45">{copy.languageNote}</p> : null}

      <nav aria-label={copy.contents} className="mt-8">
        <h2 className="u-eyebrow">{copy.contents}</h2>
        <ol lang="fr" className="mt-3 space-y-1.5">
          {TERMS_ARTICLES_FR.map((article, index) => (
            <li key={article.title}>
              <a href={`#${articleId(article, index)}`} className="u-micro text-ink-70 transition-colors hover:text-blue-deep">
                {article.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div lang="fr">
        {TERMS_ARTICLES_FR.map((article, index) => (
          <section key={article.title} id={articleId(article, index)} className="mt-10 scroll-mt-24">
            <h2 className="u-title-section text-ink">{article.title}</h2>
            {article.blocks.map((block, blockIndex) =>
              typeof block === 'string' ? (
                <p key={blockIndex} className="u-body mt-3 text-ink-70">{block}</p>
              ) : (
                <ul key={blockIndex} className="mt-3 list-disc space-y-1.5 pl-5">
                  {block.list.map((item) => (
                    <li key={item.slice(0, 40)} className="u-body text-ink-70">{item}</li>
                  ))}
                </ul>
              ),
            )}
          </section>
        ))}
      </div>

      <p className="u-micro mt-12 border-t border-line pt-6 text-ink-45">
        <Link href="/confidentialite" className="transition-colors hover:text-blue-deep">{copy.privacy}</Link>
      </p>
    </article>
  );
}
