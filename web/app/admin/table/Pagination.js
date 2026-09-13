import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { PAGE_SIZES, buildHref, pageWindow, totalPages } from '@/lib/adminPagination';
import { getT } from '@/lib/i18n/server';

const CELL =
  'u-micro-strong inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 transition-colors';

/**
 * The pager under every /admin table. Plain links — each page is a URL the
 * server renders, so it works without JavaScript and can be bookmarked.
 *
 * `pageParam`/`sizeParam` let two tables share one page (Lead Analytics has a
 * tap log and a follow-up queue) without their pages fighting over `?page=`.
 */
export default async function Pagination({
  pathname, params, total, page, pageSize, pageParam = 'page', sizeParam = 'size',
}) {
  const t = await getT();
  const pages = totalPages(total, pageSize);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const href = (overrides) => buildHref(pathname, params, overrides);
  const pageHref = (n) => {
    const next = { ...params, [pageParam]: n };
    return buildHref(pathname, next, { [pageParam]: n === 1 ? '' : n });
  };

  return (
    <nav
      aria-label={t('admin.table.pagination')}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5"
    >
      <p className="u-micro u-tabular text-ink-45">
        {t('admin.table.range', {
          from: from.toLocaleString('fr-FR'),
          to: to.toLocaleString('fr-FR'),
          total: Number(total).toLocaleString('fr-FR'),
        })}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1" aria-label={t('admin.table.perPage')}>
          <span className="u-micro text-ink-45">{t('admin.table.perPage')}</span>
          {PAGE_SIZES.map((size) => (
            <Link
              key={size}
              href={href({ [sizeParam]: size === PAGE_SIZES[0] ? '' : size, [pageParam]: '' })}
              scroll={false}
              aria-current={size === pageSize ? 'true' : undefined}
              className={`${CELL} ${size === pageSize ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-surface text-ink-70 hover:border-blue'}`}
            >
              {size}
            </Link>
          ))}
        </div>

        {pages > 1 ? (
          <div className="flex items-center gap-1">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} scroll={false} className={`${CELL} border-line bg-surface text-ink-70 hover:border-blue`} aria-label={t('admin.table.previous')}>
                <ChevronLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              </Link>
            ) : (
              <span className={`${CELL} border-line bg-canvas-alt text-ink-25`} aria-hidden="true">
                <ChevronLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              </span>
            )}
            {pageWindow(page, pages).map((n, index) =>
              n === null ? (
                <span key={`gap-${index}`} className="u-micro px-1 text-ink-35">…</span>
              ) : (
                <Link
                  key={n}
                  href={pageHref(n)}
                  scroll={false}
                  aria-current={n === page ? 'page' : undefined}
                  className={`${CELL} u-tabular ${n === page ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink-70 hover:border-blue'}`}
                >
                  {n.toLocaleString('fr-FR')}
                </Link>
              ),
            )}
            {page < pages ? (
              <Link href={pageHref(page + 1)} scroll={false} className={`${CELL} border-line bg-surface text-ink-70 hover:border-blue`} aria-label={t('admin.table.next')}>
                <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              </Link>
            ) : (
              <span className={`${CELL} border-line bg-canvas-alt text-ink-25`} aria-hidden="true">
                <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              </span>
            )}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
