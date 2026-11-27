import Link from '@/components/LocaleLink';
import { BookOpen, MoveHorizontal } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import HomeSectionHeader, { HOME_SECTION } from '@/components/HomeSectionHeader';
import { getLocale, getT } from '@/lib/i18n/server';
import { GUIDES } from '@/lib/guides';
import { listPublicPosts } from '@/lib/blog';
import { mergeArticles } from '@/lib/blogRules';
import { getFeatureFlags } from '@/lib/siteSettings';
import { memo } from '@/lib/memo';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

const MAX_CARDS = 8;

/**
 * "Guides & Actualités" on the homepage (2026-11-18, owner: the blog lower
 * down the landing page, as a carousel). The newest articles — the written
 * guides plus the published posts when the public blog is on, the same merge
 * /guides uses (lib/blogRules.js mergeArticles) — as compact cards a thumb
 * flicks through: the cover (or a royal tile for a guide without one), the
 * category and the headline. A swipe on a phone, a scroll row on a desktop.
 * Nothing renders without an article.
 */
export default async function HomeGuidesRail() {
  const t = await getT();
  const locale = await getLocale();
  const { publicBlog } = await getFeatureFlags();
  const posts = publicBlog ? await memo('home-guides:posts:v1', 300_000, () => listPublicPosts({ limit: MAX_CARDS })) : [];
  const articles = mergeArticles(GUIDES, posts, locale).slice(0, MAX_CARDS);
  if (!articles.length) return null;

  return (
    <section className="bg-canvas">
      <div className={HOME_SECTION}>
        <HomeSectionHeader title={publicBlog ? t('guides.blogTitle') : t('guides.title')} href="/guides" linkLabel={t('common.actions.seeMore')} />
        <p className="-mt-2 mb-3 flex items-center gap-1.5 text-[0.8125rem] text-ink-45 sm:hidden">
          <MoveHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
          {t('listings.gallery.swipeHint')}
        </p>
        <ul className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:gap-5 sm:px-0">
          {articles.map((article) => (
            <li key={article.slug} className="w-[72%] shrink-0 snap-start sm:w-[18rem]">
              <Link href={`/guides/${article.slug}`} className="u-press group flex h-full flex-col gap-2.5">
                <span className="relative block h-40 overflow-hidden rounded-2xl bg-blue-deep sm:h-44">
                  {article.coverUrl ? (
                    <SafeImage
                      src={article.coverUrl}
                      alt={article.coverAlt || ''}
                      fill
                      sizes="(min-width: 640px) 18rem, 72vw"
                      className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-white/80">
                      <BookOpen strokeWidth={1.5} className="h-10 w-10" />
                    </span>
                  )}
                  <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-blue-deep">
                    {article.category === 'actualite' ? t('guides.categoryNews') : t('guides.categoryGuide')}
                  </span>
                </span>
                <span className="line-clamp-2 text-[0.9375rem] font-bold leading-snug text-ink group-hover:underline group-hover:underline-offset-2">
                  {article.title}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
