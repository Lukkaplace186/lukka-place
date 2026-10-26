import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import PageShell from '@/components/PageShell';
import PropertyCard from '@/components/PropertyCard';
import JsonLd from '@/components/seo/JsonLd';
import ArticleBody from '@/components/blog/ArticleBody';
import { getPublicArticle, listPublicArticles } from '@/lib/blog';
import { postListingsHref, readingMinutes } from '@/lib/blogRules';
import { getListings } from '@/lib/listings';
import { cityOfCommune } from '@/lib/cities';
import { buildWhatsAppShareLink } from '@/lib/whatsapp';
import { SITE_URL } from '@/lib/constants';
import { getLocale, getT } from '@/lib/i18n/server';

const RELATED_LISTINGS = 3;

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const article = await getPublicArticle(slug, await getLocale());
  if (!article) return {};
  const url = `/guides/${article.slug}`;
  return {
    title: `${article.title} | Lukka Place`,
    description: article.summary,
    alternates: { canonical: url },
    openGraph: {
      title: article.title,
      description: article.summary,
      type: 'article',
      url,
      ...(article.coverUrl ? { images: [{ url: article.coverUrl, alt: article.coverAlt }] } : {}),
    },
  };
}

/** Up to three live listings matching what the post is about; [] on any failure. */
async function relatedListings(article) {
  const about = article.listings;
  if (!about || !(about.purpose || about.commune || about.propertyType)) return [];
  try {
    const { data } = await getListings({
      transactionType: about.purpose || undefined,
      commune: about.commune || undefined,
      propertyType: about.propertyType || undefined,
      ville: about.commune ? cityOfCommune(about.commune) : undefined,
      limit: RELATED_LISTINGS,
      sort: 'complete',
    });
    return data || [];
  } catch (err) {
    console.error(`[guides] related listings for ${article.slug} unavailable: ${err.message}`);
    return [];
  }
}

/** One guide or post, with Article structured data. The layout has already 404'd a missing slug. */
export default async function GuidePage({ params }) {
  const { slug } = await params;
  const t = await getT();
  const locale = await getLocale();
  const article = await getPublicArticle(slug, locale);
  if (!article) notFound();

  const [listings, all] = await Promise.all([relatedListings(article), listPublicArticles(locale)]);
  const others = all.filter((a) => a.slug !== article.slug).slice(0, 4);
  const base = SITE_URL.replace(/\/+$/, '');
  const url = `${base}/guides/${article.slug}`;
  const dateFormat = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'long', timeZone: 'Africa/Kinshasa' });
  const updated = dateFormat.format(new Date(article.updatedAt));
  const listingsHref = article.listings ? postListingsHref({ ...article.listings, property_type: article.listings.propertyType }) : null;
  const cta = article.cta || (listingsHref ? { href: listingsHref, label: t('guides.seeListings') } : null);
  const shareHref = buildWhatsAppShareLink(`${article.title}\n${url}?utm_source=whatsapp&utm_medium=guide`);

  return (
    <PageShell
      title={article.title}
      breadcrumb={[
        { label: t('breadcrumb.home'), href: '/' },
        { label: t('guides.breadcrumb'), href: '/guides' },
        { label: article.title },
      ]}
    >
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'Article',
              headline: article.title,
              description: article.summary,
              inLanguage: article.lang,
              datePublished: article.publishedAt,
              dateModified: article.updatedAt,
              mainEntityOfPage: url,
              url,
              image: article.coverUrl || `${base}/og-image.png?v=2`,
              author: { '@type': 'Organization', name: 'Lukka Place', url: base },
              publisher: { '@type': 'Organization', name: 'Lukka Place', url: base, logo: { '@type': 'ImageObject', url: `${base}/brand/icon-square-512.png` } },
            },
            {
              '@type': 'BreadcrumbList',
              itemListElement: [
                { '@type': 'ListItem', position: 1, name: t('breadcrumb.home'), item: base },
                { '@type': 'ListItem', position: 2, name: t('guides.breadcrumb'), item: `${base}/guides` },
                { '@type': 'ListItem', position: 3, name: article.title, item: url },
              ],
            },
          ],
        }}
      />
      <article lang={article.lang} className="flex flex-col gap-5 text-[1rem] leading-relaxed text-ink-70">
        <p className="text-xs text-ink-45">
          {t('guides.updated', { date: updated })}
          {' · '}
          {t('guides.readingTime', { minutes: readingMinutes(article.blocks) })}
          {locale === 'en' && article.lang === 'fr' ? ` · ${t('guides.frenchOnly')}` : ''}
        </p>
        {article.coverUrl ? (
          <div className="relative -mx-4 aspect-[16/9] overflow-hidden bg-canvas-alt sm:mx-0 sm:rounded-xl">
            <Image src={article.coverUrl} alt={article.coverAlt} fill priority sizes="(min-width: 768px) 720px, 100vw" className="object-cover" />
          </div>
        ) : null}
        <ArticleBody blocks={article.blocks} />
        <div className="mt-4 flex flex-wrap gap-3">
          {cta ? (
            <Link
              href={cta.href}
              className="u-press inline-flex items-center gap-2 rounded-lg bg-blue px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep"
            >
              {cta.label} →
            </Link>
          ) : null}
          <a
            href={shareHref}
            target="_blank"
            rel="noopener noreferrer"
            className="u-press inline-flex items-center gap-2 rounded-lg border border-line bg-white px-5 py-2.5 text-sm font-semibold text-ink"
          >
            {t('guides.shareWhatsApp')}
          </a>
        </div>
      </article>

      {listings.length > 0 ? (
        <section className="mt-12 flex flex-col gap-4 border-t border-line pt-8" lang={locale}>
          <h2 className="u-h2 text-ink">{t('guides.relatedListings')}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <PropertyCard key={listing.id} listing={listing} />
            ))}
          </div>
        </section>
      ) : null}

      {others.length > 0 ? (
        <section className="mt-14 flex flex-col gap-3 border-t border-line pt-8">
          <h2 className="u-h2 text-ink">{t('guides.related')}</h2>
          <ul className="flex flex-col gap-2">
            {others.map((a) => (
              <li key={a.slug}>
                <Link href={`/guides/${a.slug}`} lang={a.lang} className="text-[0.9375rem] font-medium text-blue-deep hover:underline">
                  {a.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </PageShell>
  );
}
