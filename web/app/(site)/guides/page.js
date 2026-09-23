import Link from 'next/link';
import PageShell from '@/components/PageShell';
import JsonLd from '@/components/seo/JsonLd';
import { GUIDES } from '@/lib/guides';
import { SITE_URL } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return {
    title: `${t('guides.title')} | Lukka Place`,
    description: t('guides.lead'),
    alternates: { canonical: '/guides' },
  };
}

/** The guides index (lib/guides.js). */
export default async function GuidesPage() {
  const t = await getT();
  const base = SITE_URL.replace(/\/+$/, '');

  return (
    <PageShell
      title={t('guides.title')}
      lead={t('guides.lead')}
      breadcrumb={[{ label: t('breadcrumb.home'), href: '/' }, { label: t('guides.breadcrumb') }]}
    >
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          itemListElement: GUIDES.map((g, i) => ({ '@type': 'ListItem', position: i + 1, url: `${base}/guides/${g.slug}`, name: g.title })),
        }}
      />
      <ul className="flex flex-col gap-4">
        {GUIDES.map((g) => (
          <li key={g.slug}>
            <Link
              href={`/guides/${g.slug}`}
              className="group flex flex-col gap-2 rounded-xl border border-line bg-surface p-5 transition-colors hover:border-ink-25"
            >
              <h2 className="text-lg font-semibold leading-snug text-ink group-hover:text-blue-deep">{g.title}</h2>
              <p className="text-[0.9375rem] leading-relaxed text-ink-70">{g.description}</p>
              <span className="text-sm font-semibold text-blue-deep">{t('guides.readMore')} →</span>
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
