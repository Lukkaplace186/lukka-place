import { notFound } from 'next/navigation';
import { getPublicArticle } from '@/lib/blog';
import { getLocale } from '@/lib/i18n/server';

/**
 * The 404 check, ABOVE this segment's loading.js: once a skeleton has
 * streamed the status is 200, and a notFound() below it is only a soft 404
 * (web/CLAUDE.md, "Real 404s"). A draft, a scheduled post before its time,
 * a deleted post, or any post while the blog is off is a real 404.
 */
export default async function GuideLayout({ children, params }) {
  const { slug } = await params;
  const article = await getPublicArticle(slug, await getLocale());
  if (!article) notFound();
  return children;
}
