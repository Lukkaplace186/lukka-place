import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { firstParam, parsePage } from '@/lib/adminPagination';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { listAttributionChanges, listReferralRefusals, listSuspiciousReferrals } from '@/lib/salesLaunch';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, formatKinshasa } from '../../LeadRoutingUI';
import Pagination from '../../table/Pagination';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../../table/TableFrame';

export const dynamic = 'force-dynamic';

function AgentLink({ id }) {
  return id ? <Link href={`/admin/agents/${id}`} className="font-semibold text-ink hover:text-blue-deep hover:underline">#{id}</Link> : '—';
}

function RepLink({ id, name }) {
  return id ? <Link href={`/admin/sales/${id}`} className="text-blue-deep hover:underline">{name || `#${id}`}</Link> : '—';
}

/**
 * Referral disputes and audit (`sales.manage`): referrals that were refused and
 * why, every attribution override with its reason, and patterns worth a look.
 * Facts with their evidence — nothing on this page penalises anyone.
 */
export default async function AdminSalesAttributionPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const refusalsPage = parsePage(raw, { pageParam: 'rpage', sizeParam: 'rsize' });
  const changesPage = parsePage(raw, { pageParam: 'hpage', sizeParam: 'hsize' });
  const query = {
    rpage: refusalsPage.page > 1 ? String(refusalsPage.page) : undefined,
    hpage: changesPage.page > 1 ? String(changesPage.page) : undefined,
    rsize: firstParam(raw.rsize),
    hsize: firstParam(raw.hsize),
  };
  const base = '/admin/sales/attribution';

  const [refusalsResult, changesResult, suspiciousResult] = await Promise.allSettled([
    listReferralRefusals(refusalsPage),
    listAttributionChanges(changesPage),
    listSuspiciousReferrals(),
  ]);
  const refusals = refusalsResult.status === 'fulfilled' ? refusalsResult.value : { total: 0, rows: [] };
  const changes = changesResult.status === 'fulfilled' ? changesResult.value : { total: 0, rows: [] };
  const suspicious = suspiciousResult.status === 'fulfilled'
    ? suspiciousResult.value
    : { sharedConnections: [], priorListings: [], day30Failures: [] };
  const failed = [refusalsResult, changesResult, suspiciousResult].find((r) => r.status === 'rejected');

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/admin/sales" className="u-micro-strong inline-flex items-center gap-1.5 text-ink-45 hover:text-ink">
          <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.sales.back')}
        </Link>
        <h1 className="u-title-page mt-2 text-ink">{t('admin.sales.attribution.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.sales.attribution.subtitle')}</p>
      </div>
      {failed ? <ErrorNote>{t('admin.sales.loadError', { error: failed.reason?.message })}</ErrorNote> : null}

      <section className="flex flex-col gap-2">
        <h2 className="u-title-card text-ink">{t('admin.sales.attribution.suspicious.title')}</h2>
        <p className="u-micro text-ink-45">{t('admin.sales.attribution.suspicious.hint')}</p>
        <div className="grid gap-5 xl:grid-cols-3">
          <TableFrame minWidth="20rem">
            <thead>
              <tr>
                <th className={TH_STICKY}>{t('admin.sales.attribution.suspicious.shared')}</th>
                <th className={TH_STICKY_RIGHT}>{t('admin.sales.attribution.suspicious.agents')}</th>
              </tr>
            </thead>
            <tbody>
              {suspicious.sharedConnections.length === 0 ? <EmptyRow colSpan={2}>{t('admin.sales.attribution.suspicious.none')}</EmptyRow> : suspicious.sharedConnections.map((row) => (
                <tr key={row.ip_hash} className={TR_DENSE}>
                  <td className={TD_DENSE}>
                    <div className="flex flex-wrap gap-1">{(row.agent_ids || []).slice(0, 12).map((id) => <AgentLink key={id} id={id} />)}</div>
                    <div className="text-ink-45">{(row.rep_names || []).join(', ')} · {formatKinshasa(row.last_at)}</div>
                  </td>
                  <td className={TD_DENSE_RIGHT}>{row.agents}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
          <TableFrame minWidth="20rem">
            <thead>
              <tr>
                <th className={TH_STICKY}>{t('admin.sales.attribution.suspicious.prior')}</th>
                <th className={TH_STICKY_RIGHT}>{t('admin.sales.attribution.suspicious.listings')}</th>
              </tr>
            </thead>
            <tbody>
              {suspicious.priorListings.length === 0 ? <EmptyRow colSpan={2}>{t('admin.sales.attribution.suspicious.none')}</EmptyRow> : suspicious.priorListings.map((row) => (
                <tr key={row.agent_id} className={TR_DENSE}>
                  <td className={TD_DENSE}><AgentLink id={row.agent_id} /> · <RepLink id={row.rep_id} name={row.rep_name} /></td>
                  <td className={TD_DENSE_RIGHT}>{row.before}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
          <TableFrame minWidth="20rem">
            <thead>
              <tr>
                <th className={TH_STICKY}>{t('admin.sales.attribution.suspicious.day30')}</th>
                <th className={TH_STICKY_RIGHT}>{t('admin.sales.attribution.suspicious.valid')}</th>
              </tr>
            </thead>
            <tbody>
              {suspicious.day30Failures.length === 0 ? <EmptyRow colSpan={2}>{t('admin.sales.attribution.suspicious.none')}</EmptyRow> : suspicious.day30Failures.map((row) => (
                <tr key={`${row.agent_id}-${row.rep_id}`} className={TR_DENSE}>
                  <td className={TD_DENSE}><AgentLink id={row.agent_id} /> · <RepLink id={row.rep_id} name={row.rep_name} /></td>
                  <td className={TD_DENSE_RIGHT}>{row.valid} / {row.checked}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="u-title-card text-ink">{t('admin.sales.attribution.changes.title')}</h2>
        <TableFrame
          minWidth="56rem"
          footer={<Pagination pathname={base} params={query} total={changes.total} page={changesPage.page} pageSize={changesPage.pageSize} pageParam="hpage" sizeParam="hsize" />}
        >
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.sales.attribution.changes.when')}</th>
              <th className={TH_STICKY}>{t('admin.sales.launch.agents.colAgent')}</th>
              <th className={TH_STICKY}>{t('admin.sales.attribution.changes.move')}</th>
              <th className={TH_STICKY}>{t('admin.sales.attribution.reason')}</th>
              <th className={TH_STICKY}>{t('admin.sales.attribution.changes.by')}</th>
            </tr>
          </thead>
          <tbody>
            {changes.rows.length === 0 ? <EmptyRow colSpan={5}>{t('admin.sales.attribution.changes.empty')}</EmptyRow> : changes.rows.map((row) => (
              <tr key={row.id} className={TR_DENSE}>
                <td className={`${TD_DENSE} whitespace-nowrap`}>{formatKinshasa(row.changed_at)}</td>
                <td className={TD_DENSE}><AgentLink id={row.agent_id} /></td>
                <td className={TD_DENSE}>
                  {row.from_rep_id ? <RepLink id={row.from_rep_id} name={row.from_rep_name} /> : t('admin.sales.attribution.changes.nobody')}
                  {' → '}
                  <RepLink id={row.to_rep_id} name={row.to_rep_name} />
                </td>
                <td className={`${TD_DENSE} max-w-[24rem] break-words`}>
                  {row.reason}
                  {row.evidence ? <div className="text-ink-45">{t('admin.sales.attribution.evidenceLine', { evidence: row.evidence })}</div> : null}
                </td>
                <td className={TD_DENSE}>{row.changed_by_name || t('admin.sales.attribution.changes.shared')}</td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="u-title-card text-ink">{t('admin.sales.attribution.refusals.title')}</h2>
        <TableFrame
          minWidth="48rem"
          footer={<Pagination pathname={base} params={query} total={refusals.total} page={refusalsPage.page} pageSize={refusalsPage.pageSize} pageParam="rpage" sizeParam="rsize" />}
        >
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.sales.attribution.changes.when')}</th>
              <th className={TH_STICKY}>{t('admin.sales.attribution.refusals.code')}</th>
              <th className={TH_STICKY}>{t('admin.sales.attribution.refusals.reason')}</th>
              <th className={TH_STICKY}>{t('admin.sales.attribution.refusals.channel')}</th>
              <th className={TH_STICKY}>{t('admin.sales.launch.agents.colAgent')}</th>
            </tr>
          </thead>
          <tbody>
            {refusals.rows.length === 0 ? <EmptyRow colSpan={5}>{t('admin.sales.attribution.refusals.empty')}</EmptyRow> : refusals.rows.map((row) => (
              <tr key={row.id} className={TR_DENSE}>
                <td className={`${TD_DENSE} whitespace-nowrap`}>{formatKinshasa(row.created_at)}</td>
                <td className={TD_DENSE}>
                  <span className="u-ref">{row.referral_code || '—'}</span>
                  {row.rep_id ? <div><RepLink id={row.rep_id} name={row.rep_name} /></div> : null}
                </td>
                <td className={TD_DENSE}><Chip tone="warning">{t(`admin.sales.attribution.refusals.reasons.${row.reason}`)}</Chip></td>
                <td className={TD_DENSE}>{t(`admin.sales.attribution.refusals.channels.${row.channel}`)}</td>
                <td className={TD_DENSE}><AgentLink id={row.agent_id} /></td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      </section>
    </div>
  );
}
