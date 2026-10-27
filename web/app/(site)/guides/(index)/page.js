import Image from 'next/image';
import Link from 'next/link';
import PageShell from '@/components/PageShell';
import JsonLd from '@/components/seo/JsonLd';
import { GUIDES } from '@/lib/guides';
import { listPublicPosts } from '@/lib/blog';
import { mergeArticles, parseCategory, readingMinutes } from '@/lib/blogRules';
import { getFeatureFlags } from '@/lib/siteSettings';
import { SITE_URL } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { getLocale, getT } from '@/lib/i18n/server';

export async function generateMetadata({ searchParams }) {
  const t = await getT();
  const { publicBlog } = await getFeatureFlags();
  const category = publicBlog ? parseCategory((await searchParams)?.categorie) : null;
  return {
    title: `${publicBlog ? t('guides.blogTitle') : t('guides.title')} | Lukka Place`,
    description: publicBlog ? t('guides.blogLead') : t('guides.lead'),
    alternates: { canonical: '/guides' },
    ...(category ? { robots: { index: false, follow: true } } : {}),
  };
}

/**
 * Guides & Actualités. With the `publicBlog` switch off (the default) this is
 * exactly the guides index it always was: the code guides of lib/guides.js.
 * On, the posts published from /admin/blog join them (a post with a guide's
 * slug replaces that guide), newest first, with Guides / Actualités tabs.
 *
 * Built for a phone on 3G: server-rendered, a list of text cards, a cover only
 * when the post has one (lazy, sized), no client JavaScript.
 */
export default async function GuidesPage({ searchParams }) {
  const t = await getT();
  const locale = await getLocale();
  const { publicBlog } = await getFeatureFlags();
  const posts = publicBlog ? await listPublicPosts() : [];
  const all = mergeArticles(GUIDES, posts, locale);
  const category = publicBlog ? parseCategory((await searchParams)?.categorie) : null;
  const articles = category ? all.filter((a) => a.category === category) : all;
  const base = SITE_URL.replace(/\/+$/, '');
  const dateFormat = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'medium', timeZone: 'Africa/Kinshasa' });

  const tabs = [
    { value: null, label: t('guides.tabAll') },
    { value: 'guide', label: t('guides.tabGuides') },
    { value: 'actualite', label: t('guides.tabNews') },
  ];

  return (
    <PageShell
      title={publicBlog ? t('guides.blogTitle') : t('guides.title')}
      lead={publicBlog ? t('guides.blogLead') : t('guides.lead')}
      breadcrumb={[{ label: t('breadcrumb.home'), href: '/' }, { label: publicBlog ? t('guides.blogBreadcrumb') : t('guides.breadcrumb') }]}
    >
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          itemListElement: articles.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: `${base}/guides/${a.slug}`, name: a.title })),
        }}
      />

      {publicBlog ? (
        <nav aria-label={t('guides.tabsLabel')} className="-mt-2 mb-5 flex gap-2">
          {tabs.map((tab) => (
            <Link
              key={tab.label}
              href={tab.value ? `/guides?categorie=${tab.value}` : '/guides'}
              aria-current={category === tab.value ? 'page' : undefined}
              className={cn(
                'inline-flex h-9 items-center rounded-full border px-3.5 text-[0.8125rem] font-semibold',
                category === tab.value ? 'border-blue bg-blue text-white' : 'border-line bg-white text-ink-70',
              )}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {articles.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-white p-8 text-center text-sm text-ink-45">{t('guides.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {articles.map((a, i) => (
            <li key={a.slug}>
              <Link
                href={`/guides/${a.slug}`}
                className="group flex flex-col overflow-hidden rounded-xl border border-line bg-surface transition-colors hover:border-ink-25 sm:flex-row"
              >
                {a.coverUrl ? (
                  <div className="relative aspect-[16/9] w-full shrink-0 bg-canvas-alt sm:aspect-auto sm:w-56">
                    <Image
                      src={a.coverUrl}
                      alt={a.coverAlt}
                      fill
                      sizes="(min-width: 640px) 224px, 100vw"
                      className="object-cover"
                      priority={i === 0}
                    />
                  </div>
                ) : null}
                <div className="flex flex-col gap-2 p-5">
                  {publicBlog ? (
                    <p className="u-eyebrow text-ink-45">
                      {a.category === 'guide' ? t('guides.categoryGuide') : t('guides.categoryNews')}
                      {' · '}
                      {dateFormat.format(new Date(a.publishedAt))}
                      {' · '}
                      {t('guides.readingTime', { minutes: readingMinutes(a.blocks) })}
                    </p>
                  ) : null}
                  <h2 className="text-lg font-semibold leading-snug text-ink group-hover:text-blue-deep" lang={a.lang}>
                    {a.title}
                  </h2>
                  {a.summary ? <p className="text-[0.9375rem] leading-relaxed text-ink-70" lang={a.lang}>{a.summary}</p> : null}
                  <span className="text-sm font-semibold text-blue-deep">{t('guides.readMore')} →</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
