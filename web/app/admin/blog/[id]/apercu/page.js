import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ArticleBody from '@/components/blog/ArticleBody';
import { getPostForAdmin } from '@/lib/blog';
import { articleFromPost, postListingsHref, postState, readingMinutes } from '@/lib/blogRules';
import { getT } from '@/lib/i18n/server';
import { firstParam } from '@/lib/adminPagination';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Aperçu — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

/**
 * The article as /guides/<slug> will show it, whatever its state and
 * whether the blog is on. The live listings block is named, not drawn (its
 * cards are storefront components); the link it would carry is shown.
 */
export default async function BlogPreviewPage({ params, searchParams }) {
  const t = await getT();
  const { id } = await params;
  const lang = firstParam((await searchParams)?.lang) === 'en' ? 'en' : 'fr';
  let post = null;
  try {
    post = await getPostForAdmin(id);
  } catch (err) {
    if (err?.code !== '42P01') throw err;
  }
  if (!post) notFound();
  const article = articleFromPost(post, lang);
  const listingsHref = postListingsHref(post);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/admin/blog/${post.id}`} className="u-micro-strong text-blue-deep hover:underline">← {t('admin.blog.backToEditor')}</Link>
        <div className="u-micro flex gap-3">
          <span className="text-ink-45">{t(`admin.blog.state.${postState(post)}`)}</span>
          {post.title_en ? (
            <Link href={`/admin/blog/${post.id}/apercu${lang === 'en' ? '' : '?lang=en'}`} className="font-semibold text-blue-deep hover:underline">
              {lang === 'en' ? 'FR' : 'EN'}
            </Link>
          ) : null}
        </div>
      </div>
      <article lang={article.lang} className="flex flex-col gap-5 rounded-card border border-line bg-surface p-5 text-[1rem] leading-relaxed text-ink-70 sm:p-8">
        <h1 className="u-title-hero text-ink">{article.title}</h1>
        {article.summary ? <p className="text-lg text-ink-70">{article.summary}</p> : null}
        <p className="text-xs text-ink-45">{t('admin.blog.readingTime', { minutes: readingMinutes(article.blocks) })}</p>
        {article.coverUrl ? (
          <div className="relative aspect-[16/9] overflow-hidden rounded-xl bg-canvas-alt">
            <Image src={article.coverUrl} alt={article.coverAlt} fill sizes="720px" className="object-cover" />
          </div>
        ) : null}
        <ArticleBody blocks={article.blocks} />
        {listingsHref ? (
          <p className="u-micro rounded-lg bg-canvas-alt px-3.5 py-2.5 text-ink-70">
            {t('admin.blog.previewListings')}{' '}
            <a href={listingsHref} target="_blank" rel="noopener noreferrer" className="break-all font-mono font-semibold text-blue-deep underline">{listingsHref}</a>
          </p>
        ) : null}
      </article>
    </div>
  );
}
