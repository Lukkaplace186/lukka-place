import Link from 'next/link';
import { AGENCY_SORTS, listAgenciesForAdmin } from '@/lib/adminAgencies';
import { firstParam, parsePage } from '@/lib/adminPagination';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote } from '../LeadRoutingUI';
import Pagination from '../table/Pagination';
import TableToolbar from '../table/TableToolbar';
import ServerViewTools from '../table/ServerViewTools';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../table/TableFrame';

export const dynamic = 'force-dynamic';

const SORT_LABEL_KEYS = {
  name: 'admin.agencies.sortName',
  newest: 'admin.agents.sortNewest',
  agents: 'admin.agencies.sortAgents',
  listings: 'admin.agencies.sortListings',
};

/**
 * Agencies — the level a team managing 30k agents actually works at. Roster
 * size, verified share, live and pending portfolio, and plan, per agency; open
 * one to act on its whole roster at once.
 */
export default async function AdminAgenciesPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const filters = {
    q: firstParam(raw.q) || undefined,
    plan: ['active', 'none'].includes(firstParam(raw.plan)) ? firstParam(raw.plan) : undefined,
    sort: AGENCY_SORTS.includes(firstParam(raw.sort)) && firstParam(raw.sort) !== 'name' ? firstParam(raw.sort) : undefined,
  };
  const { page, pageSize, limit, offset } = parsePage(raw);
  const params = { ...filters, page: page > 1 ? String(page) : undefined, size: pageSize === 25 ? undefined : String(pageSize) };

  let list = null;
  let loadError = null;
  try {
    list = await listAgenciesForAdmin({ ...filters, sort: filters.sort || 'name', limit, offset });
  } catch (err) {
    loadError = err.message;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.agencies.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.agencies.subtitle')}</p>
      </div>

      <TableToolbar
        params={params}
        search={{ placeholder: t('admin.agencies.searchPlaceholder') }}
        filters={[
          {
            type: 'select',
            param: 'plan',
            label: t('admin.agents.package'),
            options: [
              { value: 'active', label: t('admin.agencies.planActive') },
              { value: 'none', label: t('admin.agencies.planNone') },
            ],
          },
          {
            type: 'select',
            param: 'sort',
            label: t('admin.agents.sortBy'),
            allLabel: t(SORT_LABEL_KEYS.name),
            options: AGENCY_SORTS.filter((value) => value !== 'name').map((value) => ({ value, label: t(SORT_LABEL_KEYS[value]) })),
          },
        ]}
      >
        <ServerViewTools path="/admin/agencies" params={params} exportDataset="agencies" />
      </TableToolbar>

      {loadError ? <ErrorNote>{t('admin.agencies.loadError', { error: loadError })}</ErrorNote> : null}

      <TableFrame
        minWidth="60rem"
        footer={list ? <Pagination pathname="/admin/agencies" params={params} total={list.total} page={page} pageSize={pageSize} /> : null}
      >
        <thead>
          <tr>
            <th className={TH_STICKY}>{t('admin.agencies.colAgency')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.agencies.colAgents')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.agencies.colLive')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.agencies.colPending')}</th>
            <th className={TH_STICKY}>{t('admin.agents.package')}</th>
          </tr>
        </thead>
        <tbody>
          {(list?.rows || []).length === 0 ? (
            <EmptyRow colSpan={5}>{t('admin.agencies.empty')}</EmptyRow>
          ) : (
            list.rows.map((agency) => (
              <tr key={agency.id} className={TR_DENSE}>
                <td className={TD_DENSE}>
                  <Link href={`/admin/agencies/${agency.id}`} className="font-semibold text-ink hover:text-blue-deep hover:underline">{agency.username}</Link>
                  <div className="text-ink-45">{[agency.email, agency.phone ? `+${agency.phone}` : null].filter(Boolean).join(' · ') || `#${agency.id}`}</div>
                </td>
                <td className={TD_DENSE_RIGHT}>
                  <span className="font-semibold text-ink">{agency.agents}</span>
                  <div className="text-ink-45">{t('admin.agencies.verifiedShort', { count: agency.verified_agents })}</div>
                </td>
                <td className={TD_DENSE_RIGHT}>{agency.live_listings}</td>
                <td className={TD_DENSE_RIGHT}>{agency.pending_listings ? <span className="font-semibold text-warning">{agency.pending_listings}</span> : 0}</td>
                <td className={TD_DENSE}>
                  {agency.package_title ? (
                    <>
                      <div className="text-ink">{agency.package_title}{agency.is_trial ? <span className="ml-1.5"><Chip>{t('admin.agencies.trial')}</Chip></span> : null}</div>
                      <div className="text-ink-45">{t('admin.agents.until', { date: new Date(agency.expire_date).toLocaleDateString('fr-FR', { timeZone: 'UTC' }) })}</div>
                    </>
                  ) : <span className="text-ink-35">{t('admin.agents.noActiveSubscription')}</span>}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </TableFrame>
    </div>
  );
}
