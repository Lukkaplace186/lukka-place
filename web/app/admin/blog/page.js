import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { listPostsForAdmin } from '@/lib/blog';
import { postState } from '@/lib/blogRules';
import { getFeatureFlags } from '@/lib/siteSettings';
import { buildHref, firstParam, parsePage } from '@/lib/adminPagination';
import { Chip, ErrorNote, formatKinshasa } from '../LeadRoutingUI';
import Pagination from '../table/Pagination';
import TableToolbar from '../table/TableToolbar';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../table/TableFrame';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Guides & Actualités — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

const PATH = '/admin/blog';
const STATE_TONE = { draft: 'neutral', scheduled: 'warning', published: 'success' };

/**
 * Guides & Actualités (lib/blog.js). Every live post, newest edit first. The
 * banner says whether the public sees any of it: the `publicBlog` switch on
 * /admin/settings, off by default.
 */
export default async function AdminBlogPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const q = String(firstParam(raw.q) || '').trim();
  const { page, pageSize, limit, offset } = parsePage(raw);
  const params = { q: q || undefined, page: page > 1 ? String(page) : undefined, size: pageSize === 25 ? undefined : String(pageSize) };
  const { publicBlog } = await getFeatureFlags();

  let result = null;
  let loadError = null;
  try {
    result = await listPostsForAdmin({ q, limit, offset });
  } catch (err) {
    loadError = err?.code === '42P01' ? t('admin.blog.missingTable') : err.message;
  }
  const now = new Date();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.blog.title')}</h1>
          <p className="u-micro mt-1 max-w-[70ch] text-ink-45">{t('admin.blog.lead')}</p>
        </div>
        <Link href="/admin/blog/nouveau" className="u-press inline-flex h-10 items-center rounded-lg bg-blue px-4 text-sm font-bold text-white hover:bg-blue-deep">
          {t('admin.blog.new')}
        </Link>
      </div>

      <p className={`u-micro rounded-lg px-3.5 py-2.5 ${publicBlog ? 'bg-success-tint text-success' : 'bg-warning-tint text-warning-ink'}`}>
        {publicBlog ? t('admin.blog.blogOn') : t('admin.blog.blogOff')}{' '}
        <Link href="/admin/settings" className="font-semibold underline">{t('admin.blog.settingsLink')}</Link>
      </p>

      {firstParam(raw.deleted) ? <p className="u-micro-strong rounded-lg bg-success-tint px-3.5 py-2.5 text-success" role="status">{t('admin.blog.deleted')}</p> : null}
      {loadError ? <ErrorNote>{loadError}</ErrorNote> : null}

      <TableToolbar params={params} search={{ placeholder: t('admin.blog.searchPlaceholder') }} />

      {result ? (
        <TableFrame minWidth="44rem" footer={<Pagination pathname={PATH} params={params} total={result.total} page={page} pageSize={pageSize} />}>
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.blog.colTitle')}</th>
              <th className={TH_STICKY}>{t('admin.blog.colCategory')}</th>
              <th className={TH_STICKY}>{t('admin.blog.colState')}</th>
              <th className={TH_STICKY}>{t('admin.blog.colPublished')}</th>
              <th className={TH_STICKY}>{t('admin.blog.colUpdated')}</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.length === 0 ? <EmptyRow colSpan={5}>{q ? t('admin.blog.noMatch') : t('admin.blog.empty')}</EmptyRow> : null}
            {result.rows.map((row) => {
              const state = postState(row, now);
              return (
                <tr key={row.id} className={TR_DENSE}>
                  <td className={TD_DENSE}>
                    <Link href={`/admin/blog/${row.id}`} className="font-semibold text-blue-deep hover:underline">{row.title_fr}</Link>
                    <div className="font-mono text-[0.75rem] text-ink-45">/guides/{row.slug}{row.title_en ? ' · EN' : ''}</div>
                  </td>
                  <td className={TD_DENSE}>{row.category === 'guide' ? t('admin.blog.categoryGuide') : t('admin.blog.categoryNews')}</td>
                  <td className={TD_DENSE}><Chip tone={STATE_TONE[state]}>{t(`admin.blog.state.${state}`)}</Chip></td>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>{row.published_at ? formatKinshasa(row.published_at) : '—'}</td>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>{formatKinshasa(row.updated_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </TableFrame>
      ) : null}
    </div>
  );
}
