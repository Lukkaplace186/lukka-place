import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { getAdminSession } from '@/lib/adminSession';
import { can } from '@/lib/adminRoles';
import { firstParam } from '@/lib/adminPagination';
import { listProspects, prospectAdverts, prospectCounts } from '@/lib/marketProspects';
import { MANUAL_SOURCES, SOURCE_NAMES } from '@/lib/marketObservationRules';
import { OPEN_PROSPECT_STATUSES, PROSPECT_STATUSES } from '@/lib/marketProspectRules';
import { ErrorNote, Stat } from '../../LeadRoutingUI';
import ProspectRow from './ProspectRow';

export const metadata = {
  title: 'Prospects agents — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/**
 * "Prospects agents": the people who posted the adverts the team pastes on
 * /admin/market-data/marche ("Coller des annonces"), one per phone number,
 * with the team's follow-up. Replaces the separate tracker page, so an
 * advert is typed once and feeds both the price guide and this list.
 */
export default async function ProspectsPage({ searchParams }) {
  const t = await getT();
  const session = await getAdminSession();
  const canManage = can(session?.role, 'market.manage');
  const raw = (await searchParams) || {};
  const statusParam = firstParam(raw.status);
  const status = statusParam === 'all' || PROSPECT_STATUSES.includes(statusParam) ? statusParam : 'open';
  const q = String(firstParam(raw.q) || '').slice(0, 80);
  const page = Math.max(1, Number.parseInt(firstParam(raw.page), 10) || 1);

  const [list, counts] = await Promise.all([
    listProspects({ status, q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }).catch((err) => ({ error: err.message, rows: [], total: 0, available: true })),
    prospectCounts().catch(() => null),
  ]);
  const adverts = await prospectAdverts(list.rows.map((row) => row.id)).catch(() => ({}));
  const notMigrated = list.available === false || counts === null;
  const c = counts || {};
  const openCount = OPEN_PROSPECT_STATUSES.reduce((sum, s) => sum + (c[s] || 0), 0);
  const allCount = PROSPECT_STATUSES.reduce((sum, s) => sum + (c[s] || 0), 0);
  const pages = Math.max(1, Math.ceil((list.total || 0) / PAGE_SIZE));
  const sourceNames = Object.fromEntries(MANUAL_SOURCES.map((key) => [key, SOURCE_NAMES[key]]));

  const href = (changes) => {
    const params = new URLSearchParams();
    const next = { status, q, page: 1, ...changes };
    for (const [key, value] of Object.entries(next)) {
      if (!value || (key === 'page' && value === 1) || (key === 'status' && value === 'open')) continue;
      params.set(key, value);
    }
    const query = params.toString();
    return `/admin/market-data/prospects${query ? `?${query}` : ''}`;
  };
  const exportParams = new URLSearchParams({ status, ...(q ? { q } : {}) }).toString();
  const chip = (value, label, n) => (
    <Link
      key={value}
      href={href({ status: value })}
      className={`u-micro-strong rounded-full border px-3 py-1 ${status === value ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line text-ink-70 hover:border-blue'}`}
    >
      {label} <span className="u-tabular font-normal text-ink-45">{n}</span>
    </Link>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/market-data/marche" className="u-micro-strong text-ink-70 hover:text-ink">{t('admin.marketObservations.title')}</Link>
        <h1 className="u-title-page mt-1 text-ink">{t('admin.marketProspects.title')}</h1>
        <p className="u-micro mt-1 max-w-3xl text-ink-45">{t('admin.marketProspects.subtitle')}</p>
      </div>

      {notMigrated ? <ErrorNote>{t('admin.marketPaste.errors.notMigrated')}</ErrorNote> : null}
      {list.error ? <ErrorNote>{list.error}</ErrorNote> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('admin.marketProspects.statTotal')} value={allCount} />
        <Stat label={t('admin.marketProspects.statTodo')} value={c.todo || 0} />
        <Stat label={t('admin.marketProspects.statInterested')} value={(c.interested || 0) + (c.callback || 0)} />
        <Stat label={t('admin.marketProspects.statSigned')} value={c.signed || 0} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {chip('open', t('admin.marketProspects.filterOpen'), openCount)}
          {PROSPECT_STATUSES.map((s) => chip(s, t(`admin.marketProspects.status.${s}`), c[s] || 0))}
          {chip('all', t('admin.marketProspects.filterAll'), allCount)}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <form action="/admin/market-data/prospects" className="flex min-w-0 flex-1 gap-2">
            {status !== 'open' ? <input type="hidden" name="status" value={status} /> : null}
            <input
              name="q"
              defaultValue={q}
              placeholder={t('admin.marketProspects.searchPlaceholder')}
              className="u-micro h-9 w-full max-w-sm rounded-lg border border-line bg-surface px-3 text-ink focus:border-blue focus:outline-none"
            />
            <button type="submit" className="u-press u-micro-strong h-9 rounded-lg border border-line bg-surface px-3 text-ink hover:border-blue">{t('admin.marketProspects.search')}</button>
          </form>
          <a href={`/admin/export/prospects?${exportParams}`} className="u-micro-strong text-blue-deep hover:underline">{t('admin.marketProspects.export')}</a>
          {canManage ? <Link href="/admin/market-data/marche#coller" className="u-press u-micro-strong inline-flex h-9 items-center rounded-lg bg-blue px-3 text-white hover:bg-blue-deep">{t('admin.marketProspects.pasteMore')}</Link> : null}
        </div>
      </div>

      {list.rows.length ? (
        <ul className="flex flex-col gap-2.5">
          {list.rows.map((row) => (
            <ProspectRow key={row.id} prospect={row} adverts={adverts[row.id] || []} sourceNames={sourceNames} canManage={canManage} />
          ))}
        </ul>
      ) : !notMigrated ? (
        <p className="u-micro rounded-card border border-dashed border-line bg-surface p-6 text-center text-ink-45">
          {q || status !== 'open' ? t('admin.marketProspects.emptyFiltered') : t('admin.marketProspects.empty')}
        </p>
      ) : null}

      {pages > 1 ? (
        <div className="u-micro flex items-center gap-3 text-ink-70">
          {page > 1 ? <Link href={href({ page: page - 1 })} className="hover:text-ink">← {t('admin.marketObservations.previous')}</Link> : null}
          <span>{t('admin.marketObservations.pageOf', { page, pages })}</span>
          {page < pages ? <Link href={href({ page: page + 1 })} className="hover:text-ink">{t('admin.marketObservations.next')} →</Link> : null}
        </div>
      ) : null}
    </div>
  );
}
