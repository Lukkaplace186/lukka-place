import Link from 'next/link';
import { getAdminSession } from '@/lib/adminSession';
import { can } from '@/lib/adminRoles';
import { listListingReports } from '@/lib/listingReports';
import { REPORT_STATUSES } from '@/lib/listingReportRules';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, formatKinshasa } from '../LeadRoutingUI';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../table/TableFrame';
import { setListingReportStatusAction } from './actions';

export const metadata = {
  title: 'Signalements — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const REASON_TONE = { scam: 'danger', unavailable: 'warning', wrong_price: 'warning', wrong_info: 'neutral', duplicate: 'neutral', other: 'neutral' };

/**
 * Signalements (2026-11-27): what visitors reported with "Signaler cette
 * annonce" on a listing (lib/listingReports.js), newest first. A report is a
 * lead for the team, never a verdict: the row links to the listing and its
 * console page, where suspending or correcting happens; here the team only
 * records "Traité" or "Ignoré". Several open reports on one listing are
 * counted on each row.
 */
export default async function AdminListingReportsPage({ searchParams }) {
  const t = await getT();
  const params = await searchParams;
  const view = REPORT_STATUSES.includes(params?.statut) ? params.statut : 'open';
  const session = await getAdminSession();
  const canAct = Boolean(session && can(session.role, 'listings.moderate'));

  let data = { ready: true, rows: [], counts: {} };
  let loadError = null;
  try {
    data = await listListingReports({ status: view });
  } catch (err) {
    loadError = err.message;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.reports.title')}</h1>
        <p className="u-micro mt-1 max-w-3xl text-ink-45">{t('admin.reports.subtitle')}</p>
      </div>

      <nav aria-label={t('admin.reports.title')} className="flex flex-wrap gap-2">
        {REPORT_STATUSES.map((status) => (
          <Link
            key={status}
            href={status === 'open' ? '/admin/signalements' : `/admin/signalements?statut=${status}`}
            aria-current={status === view ? 'page' : undefined}
            className={`u-micro-strong inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 ${
              status === view ? 'bg-ink text-white' : 'border border-line text-ink-70 hover:bg-canvas-alt'
            }`}
          >
            {t(`admin.reports.status.${status}`)}
            <span className="u-tabular opacity-70">{data.counts?.[status] ?? 0}</span>
          </Link>
        ))}
      </nav>

      {loadError ? <ErrorNote>{t('admin.reports.loadError', { error: loadError })}</ErrorNote> : null}
      {!data.ready ? <ErrorNote>{t('admin.reports.notReady')}</ErrorNote> : null}

      <TableFrame minWidth="60rem">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.reports.cols.time')}</th>
              <th className={TH_STICKY}>{t('admin.reports.cols.listing')}</th>
              <th className={TH_STICKY}>{t('admin.reports.cols.reason')}</th>
              <th className={TH_STICKY}>{t('admin.reports.cols.note')}</th>
              <th className={TH_STICKY}>{t('admin.reports.cols.from')}</th>
              <th className={TH_STICKY}>{t('admin.reports.cols.action')}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length ? data.rows.map((row) => {
              const gone = row.listing_title == null;
              const live = !gone && Number(row.listing_visible) === 1 && Number(row.listing_approved) === 1;
              return (
                <tr key={row.id} className={TR_DENSE}>
                  <td className={`${TD_DENSE} u-tabular whitespace-nowrap`}>{formatKinshasa(row.created_at)}</td>
                  <td className={TD_DENSE}>
                    {gone ? (
                      <span className="text-ink-45">{t('admin.reports.listingGone', { id: row.property_id })}</span>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        <Link href={`/admin/listings/${row.property_id}`} className="font-semibold text-blue-deep hover:underline">
                          #{row.property_id} · {row.listing_title}
                        </Link>
                        <span className="text-ink-45">
                          {live ? (
                            <a href={`/listings/${row.property_id}`} target="_blank" rel="noopener noreferrer" className="hover:underline">{t('admin.reports.viewPublic')}</a>
                          ) : t('admin.reports.notPublic')}
                          {row.open_on_listing > 1 ? ` · ${t('admin.reports.openOnListing', { count: row.open_on_listing })}` : ''}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className={TD_DENSE}>
                    <Chip tone={REASON_TONE[row.reason] || 'neutral'}>{t(`listings.detail.report.reasons.${row.reason}`)}</Chip>
                  </td>
                  <td className={`${TD_DENSE} max-w-[22rem] whitespace-pre-line`}>{row.note || <span className="text-ink-35">{t('admin.reports.noNote')}</span>}</td>
                  <td className={TD_DENSE}>{t(row.from_customer ? 'admin.reports.fromCustomer' : 'admin.reports.fromVisitor')}</td>
                  <td className={TD_DENSE}>
                    {row.status !== 'open' ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-ink-45">{t('admin.reports.handled', { who: row.handled_by || '—', when: row.handled_at ? formatKinshasa(row.handled_at) : '—' })}</span>
                        {canAct ? (
                          <form action={setListingReportStatusAction}>
                            <input type="hidden" name="report_id" value={row.id} />
                            <input type="hidden" name="status" value="open" />
                            <input type="hidden" name="view" value={view} />
                            <button type="submit" className="u-micro-strong text-blue-deep hover:underline">{t('admin.reports.reopen')}</button>
                          </form>
                        ) : null}
                      </div>
                    ) : canAct ? (
                      <div className="flex flex-wrap gap-2">
                        {['resolved', 'dismissed'].map((status) => (
                          <form key={status} action={setListingReportStatusAction}>
                            <input type="hidden" name="report_id" value={row.id} />
                            <input type="hidden" name="status" value={status} />
                            <input type="hidden" name="view" value={view} />
                            <button
                              type="submit"
                              className={`u-micro-strong inline-flex min-h-8 items-center rounded-md px-2.5 ${
                                status === 'resolved' ? 'bg-blue text-white' : 'border border-line text-ink-70 hover:bg-canvas-alt'
                              }`}
                            >
                              {t(`admin.reports.mark.${status}`)}
                            </button>
                          </form>
                        ))}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            }) : (
              <EmptyRow colSpan={6}>{t(`admin.reports.empty.${view}`)}</EmptyRow>
            )}
          </tbody>
        </table>
      </TableFrame>
    </div>
  );
}
