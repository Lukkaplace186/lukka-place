import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import PostEditor from '../PostEditor';
import { editorOptions } from '../editorOptions';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Nouvel article — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export default async function NewBlogPostPage() {
  const t = await getT();
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <Link href="/admin/blog" className="u-micro-strong text-blue-deep hover:underline">← {t('admin.blog.title')}</Link>
        <h1 className="u-title-page mt-2 text-ink">{t('admin.blog.new')}</h1>
      </div>
      <PostEditor post={null} {...editorOptions(t)} />
    </div>
  );
}
