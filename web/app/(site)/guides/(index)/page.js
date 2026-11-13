import Link from 'next/link';
import PageShell from '@/components/PageShell';
import JsonLd from '@/components/seo/JsonLd';
import GuideCards from '@/components/blog/GuideCards';
import { GUIDES } from '@/lib/guides';
import { listPublicPosts } from '@/lib/blog';
import { articleIntro, mergeArticles, parseCategory, readingMinutes } from '@/lib/blogRules';
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
 * The cards are App Store "Today" tiles that open in place (GuideCards, the
 * one page that loads Motion — owner's request 2026-11-13). Still built for a
 * phone on 3G: every card is server-rendered as a real link to its article,
 * so it works before the JavaScript arrives, and Motion's layout features
 * load lazily after that.
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
        <GuideCards
          articles={articles.map((a) => ({
            slug: a.slug,
            title: a.title,
            summary: a.summary || '',
            intro: articleIntro(a.blocks),
            lang: a.lang,
            coverUrl: a.coverUrl,
            coverAlt: a.coverAlt,
            eyebrow: publicBlog
              ? `${a.category === 'guide' ? t('guides.categoryGuide') : t('guides.categoryNews')} · ${dateFormat.format(new Date(a.publishedAt))}`
              : t('guides.categoryGuide'),
            readingTime: t('guides.readingTime', { minutes: readingMinutes(a.blocks) }),
          }))}
          labels={{ readFull: t('guides.readFull'), close: t('guides.close') }}
        />
      )}
    </PageShell>
  );
}
