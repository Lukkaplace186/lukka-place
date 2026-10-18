import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { buildHref, firstParam, parsePage } from '@/lib/adminPagination';
import { listAgentReviews } from '@/lib/adminApi';
import { Chip, ErrorNote, formatKinshasa } from '../LeadRoutingUI';
import Pagination from '../table/Pagination';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../table/TableFrame';
import { moderateAgentReviewAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Avis agents — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

const PATH = '/admin/agent-reviews';

/** Tab → engine comment_status filter. "all" sends none. */
const TABS = [
  { key: 'pending', status: 'PENDING', labelKey: 'admin.reviews.filterPending' },
  { key: 'approved', status: 'APPROVED', labelKey: 'admin.reviews.filterApproved' },
  { key: 'rejected', status: 'REJECTED', labelKey: 'admin.reviews.filterRejected' },
  { key: 'all', status: null, labelKey: 'admin.reviews.filterAll' },
];

const COMMENT_TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' };

const FLASH = {
  approved: { tone: 'success', key: 'admin.reviews.approved' },
  rejected: { tone: 'success', key: 'admin.reviews.rejected' },
  failed: { tone: 'danger', key: 'admin.reviews.failed' },
};

const BUTTON = 'u-press inline-flex h-8 items-center rounded-md px-3 text-[0.8125rem] font-bold';

/**
 * Customer ratings of agents (engine services/agentReviews.js). Stars count
 * on the agent's page as soon as they are given; this queue only decides
 * whether a customer's comment is published there. Reading is agents.view
 * (section permission); publishing or refusing is listings.moderate.
 */
export default async function AdminAgentReviewsPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const tab = TABS.find((entry) => entry.key === firstParam(raw.tab)) || TABS[0];
  const { page, pageSize, limit, offset } = parsePage(raw);
  const params = {
    tab: tab.key === 'pending' ? undefined : tab.key,
    page: page > 1 ? String(page) : undefined,
    size: pageSize === 25 ? undefined : String(pageSize),
  };
  const returnTo = buildHref(PATH, params);
  const session = await getAdminSession();
  const canModerate = can(session?.role, 'listings.moderate');

  let result = null;
  let loadError = null;
  try {
    result = await listAgentReviews({ commentStatus: tab.status || undefined, limit, offset });
  } catch (err) {
    loadError = err.message;
  }
  const rows = result?.data || [];
  const flash = FLASH[firstParam(raw.flash)];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.reviews.title')}</h1>
        <p className="u-micro mt-1 max-w-[70ch] text-ink-45">{t('admin.reviews.lead')}</p>
      </div>

      {flash ? (
        <p
          className={`u-micro-strong rounded-lg px-3.5 py-2.5 ${flash.tone === 'success' ? 'bg-success-tint text-success' : 'bg-danger-tint text-danger'}`}
          role={flash.tone === 'success' ? 'status' : 'alert'}
        >
          {t(flash.key)}
        </p>
      ) : null}

      <nav className="flex flex-wrap gap-2" aria-label={t('admin.reviews.title')}>
        {TABS.map((entry) => {
          const active = entry.key === tab.key;
          return (
            <Link
              key={entry.key}
              href={buildHref(PATH, params, { tab: entry.key === 'pending' ? '' : entry.key, page: '' })}
              aria-current={active ? 'page' : undefined}
              className={`u-micro-strong rounded-full border px-3.5 py-1.5 ${active ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line text-ink-70 hover:bg-canvas-alt'}`}
            >
              {t(entry.labelKey)}
            </Link>
          );
        })}
      </nav>

      {loadError ? <ErrorNote>{loadError}</ErrorNote> : null}
      {result && result.available === false ? <ErrorNote>{t('admin.reviews.unavailable')}</ErrorNote> : null}

      {result ? (
        <TableFrame
          minWidth="52rem"
          footer={<Pagination pathname={PATH} params={params} total={result.total} page={page} pageSize={pageSize} />}
        >
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.reviews.agent')}</th>
              <th className={TH_STICKY}>{t('admin.reviews.stars')}</th>
              <th className={TH_STICKY}>{t('admin.reviews.comment')}</th>
              <th className={TH_STICKY}>{t('admin.reviews.date')}</th>
              <th className={TH_STICKY} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={5}>{t('admin.reviews.empty')}</EmptyRow> : null}
            {rows.map((row) => (
              <tr key={row.id} className={TR_DENSE}>
                <td className={TD_DENSE}>
                  <Link href={`/admin/agents/${row.agent_id}`} className="font-semibold text-blue-deep hover:underline">
                    {row.agent_name || `Agent #${row.agent_id}`}
                  </Link>
                  <div className="text-ink-45">{t('admin.reviews.visit', { id: row.viewing_request_id })}</div>
                </td>
                <td className={`${TD_DENSE} u-tabular font-bold text-ink`}>{row.stars}/5</td>
                <td className={TD_DENSE}>
                  {row.comment ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-ink">{row.comment}</span>
                      <span><Chip tone={COMMENT_TONE[row.comment_status] || 'neutral'}>{t(`admin.reviews.filter${row.comment_status === 'PENDING' ? 'Pending' : row.comment_status === 'APPROVED' ? 'Approved' : 'Rejected'}`)}</Chip></span>
                    </div>
                  ) : (
                    <span className="text-ink-45">{t('admin.reviews.noComment')}</span>
                  )}
                </td>
                <td className={`${TD_DENSE} whitespace-nowrap`}>{formatKinshasa(row.created_at)}</td>
                <td className={TD_DENSE}>
                  {canModerate && row.comment ? (
                    <form action={moderateAgentReviewAction} className="flex gap-2">
                      <input type="hidden" name="review_id" value={row.id} />
                      <input type="hidden" name="agent_id" value={row.agent_id} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      {row.comment_status !== 'APPROVED' ? (
                        <button type="submit" name="status" value="APPROVED" className={`${BUTTON} bg-blue text-white`}>
                          {t('admin.reviews.approve')}
                        </button>
                      ) : null}
                      {row.comment_status !== 'REJECTED' ? (
                        <button type="submit" name="status" value="REJECTED" className={`${BUTTON} text-danger ring-1 ring-inset ring-line`}>
                          {t('admin.reviews.reject')}
                        </button>
                      ) : null}
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      ) : null}
    </div>
  );
}
