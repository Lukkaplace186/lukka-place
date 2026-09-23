import Link from 'next/link';
import { notFound } from 'next/navigation';
import PageShell from '@/components/PageShell';
import JsonLd from '@/components/seo/JsonLd';
import { GUIDES, getGuide } from '@/lib/guides';
import { SITE_URL } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) return {};
  return {
    title: `${guide.title} | Lukka Place`,
    description: guide.description,
    alternates: { canonical: `/guides/${guide.slug}` },
    openGraph: { title: guide.title, description: guide.description, type: 'article', url: `/guides/${guide.slug}` },
  };
}

function Block({ block }) {
  if (block.h2) return <h2 className="u-h2 mt-4 text-ink">{block.h2}</h2>;
  if (block.p) return <p>{block.p}</p>;
  if (block.ul) {
    return (
      <ul className="flex list-disc flex-col gap-2 pl-5">
        {block.ul.map((item) => <li key={item}>{item}</li>)}
      </ul>
    );
  }
  if (block.ol) {
    return (
      <ol className="flex list-decimal flex-col gap-2 pl-5">
        {block.ol.map((item) => <li key={item}>{item}</li>)}
      </ol>
    );
  }
  return null;
}

/** One guide (lib/guides.js), with Article structured data. */
export default async function GuidePage({ params }) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();

  const t = await getT();
  const base = SITE_URL.replace(/\/+$/, '');
  const url = `${base}/guides/${guide.slug}`;
  const others = GUIDES.filter((g) => g.slug !== guide.slug);
  const updated = new Intl.DateTimeFormat(t.locale === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'long' }).format(new Date(guide.updated));

  return (
    <PageShell
      title={guide.title}
      breadcrumb={[
        { label: t('breadcrumb.home'), href: '/' },
        { label: t('guides.breadcrumb'), href: '/guides' },
        { label: guide.title },
      ]}
    >
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'Article',
              headline: guide.title,
              description: guide.description,
              inLanguage: 'fr',
              datePublished: guide.published,
              dateModified: guide.updated,
              mainEntityOfPage: url,
              url,
              image: `${base}/og-image.png?v=2`,
              author: { '@type': 'Organization', name: 'Lukka Place', url: base },
              publisher: { '@type': 'Organization', name: 'Lukka Place', url: base, logo: { '@type': 'ImageObject', url: `${base}/brand/icon-square-512.png` } },
            },
            {
              '@type': 'BreadcrumbList',
              itemListElement: [
                { '@type': 'ListItem', position: 1, name: t('breadcrumb.home'), item: base },
                { '@type': 'ListItem', position: 2, name: t('guides.breadcrumb'), item: `${base}/guides` },
                { '@type': 'ListItem', position: 3, name: guide.title, item: url },
              ],
            },
          ],
        }}
      />
      <article lang="fr" className="flex flex-col gap-5 text-[1rem] leading-relaxed text-ink-70">
        <p className="text-xs text-ink-45">
          {t('guides.updated', { date: updated })}
          {t.locale === 'en' ? ` · ${t('guides.frenchOnly')}` : ''}
        </p>
        {guide.body.map((block, i) => <Block key={i} block={block} />)}
        <div className="mt-4">
          <Link
            href={guide.cta.href}
            className="u-press inline-flex items-center gap-2 rounded-lg bg-blue px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep"
          >
            {guide.cta.label} →
          </Link>
        </div>
      </article>

      <section className="mt-14 flex flex-col gap-3 border-t border-line pt-8">
        <h2 className="u-h2 text-ink">{t('guides.related')}</h2>
        <ul className="flex flex-col gap-2">
          {others.map((g) => (
            <li key={g.slug}>
              <Link href={`/guides/${g.slug}`} className="text-[0.9375rem] font-medium text-blue-deep hover:underline">
                {g.title}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}
