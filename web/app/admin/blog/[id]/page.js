import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getT } from '@/lib/i18n/server';
import { getPostForAdmin } from '@/lib/blog';
import { postState } from '@/lib/blogRules';
import { getFeatureFlags } from '@/lib/siteSettings';
import { firstParam } from '@/lib/adminPagination';
import { Chip } from '../../LeadRoutingUI';
import PostEditor from '../PostEditor';
import { editorOptions } from '../editorOptions';
import { deletePostAction, unpublishPostAction } from '../actions';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Article — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

const STATE_TONE = { draft: 'neutral', scheduled: 'warning', published: 'success' };

export default async function EditBlogPostPage({ params, searchParams }) {
  const t = await getT();
  const { id } = await params;
  const raw = (await searchParams) || {};
  let post = null;
  try {
    post = await getPostForAdmin(id);
  } catch (err) {
    if (err?.code !== '42P01') throw err;
  }
  if (!post) notFound();
  const state = postState(post);
  const { publicBlog } = await getFeatureFlags();
  const live = state === 'published' && publicBlog;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <Link href="/admin/blog" className="u-micro-strong text-blue-deep hover:underline">← {t('admin.blog.title')}</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="u-title-page text-ink">{post.title_fr}</h1>
          <Chip tone={STATE_TONE[state]}>{t(`admin.blog.state.${state}`)}</Chip>
        </div>
        <div className="u-micro mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <Link href={`/admin/blog/${post.id}/apercu`} className="font-semibold text-blue-deep hover:underline">{t('admin.blog.preview')}</Link>
          {live ? (
            <a href={`/guides/${post.slug}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-deep hover:underline">
              {t('admin.blog.viewLive')}
            </a>
          ) : null}
        </div>
      </div>

      {firstParam(raw.created) ? <p className="u-micro-strong rounded-lg bg-success-tint px-3.5 py-2.5 text-success" role="status">{t('admin.blog.created')}</p> : null}
      {firstParam(raw.unpublished) ? <p className="u-micro-strong rounded-lg bg-success-tint px-3.5 py-2.5 text-success" role="status">{t('admin.blog.unpublishedDone')}</p> : null}

      <PostEditor post={post} {...editorOptions(t)} />

      <section className="flex flex-wrap items-start gap-3 rounded-card border border-line bg-surface p-4">
        {post.status === 'published' ? (
          <form action={unpublishPostAction}>
            <input type="hidden" name="id" value={post.id} />
            <button type="submit" className="u-press inline-flex h-9 items-center rounded-lg border border-line px-4 text-sm font-semibold text-ink hover:bg-canvas-alt">
              {t('admin.blog.unpublish')}
            </button>
          </form>
        ) : null}
        <details>
          <summary className="u-press inline-flex h-9 cursor-pointer list-none items-center rounded-lg border border-danger/40 px-4 text-sm font-semibold text-danger">
            {t('admin.blog.delete')}
          </summary>
          <form action={deletePostAction} className="mt-2 flex flex-col gap-2 rounded-lg bg-danger-tint p-3">
            <input type="hidden" name="id" value={post.id} />
            <p className="u-micro text-danger">{t('admin.blog.deleteConfirm')}</p>
            <button type="submit" className="u-press inline-flex h-9 items-center self-start rounded-lg bg-danger px-4 text-sm font-bold text-white">
              {t('admin.blog.deleteYes')}
            </button>
          </form>
        </details>
      </section>
    </div>
  );
}
