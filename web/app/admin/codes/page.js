import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { getAdminSession } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { listRecentCodes } from '@/lib/verificationCodes';
import { CODE_LOG_SHOW_MINUTES, newestPerPhone } from '@/lib/verificationCodeRules';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, formatKinshasa } from '../LeadRoutingUI';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../table/TableFrame';

export const metadata = {
  title: 'Codes envoyés — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Codes envoyés (owner, 2026-11-24): every verification code the website sent
 * in the last hour — customers' sign-in codes, agents' confirmation codes,
 * password resets, number changes — so that when one does not arrive (Chakra
 * confirms no delivery) the team can read it out over the phone. Owner and
 * support (`customers.manage`, lib/adminRoles.js); each opening is written to
 * the audit log, since the page shows codes in clear. Rows are kept 24 h
 * (lib/verificationCodes.js).
 */
export default async function AdminCodesPage() {
  const t = await getT();
  const session = await getAdminSession();
  let data = { ready: true, rows: [] };
  let loadError = null;
  try {
    data = await listRecentCodes();
  } catch (err) {
    loadError = err.message;
  }
  if (session) await recordAudit(session, { action: 'codes.view', details: { shown: data.rows.length } });

  const newest = newestPerPhone(data.rows);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.codes.title')}</h1>
          <p className="u-micro mt-1 max-w-3xl text-ink-45">{t('admin.codes.subtitle', { minutes: CODE_LOG_SHOW_MINUTES })}</p>
        </div>
        <Link href="/admin/codes" className="u-micro-strong inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line px-3 text-ink-70 hover:bg-canvas-alt">
          <RefreshCw strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
          {t('admin.codes.refresh')}
        </Link>
      </div>

      <p className="u-micro rounded-md bg-amber-50 px-3 py-2 text-ink-70">{t('admin.codes.warning')}</p>

      {loadError ? <ErrorNote>{t('admin.codes.loadError', { error: loadError })}</ErrorNote> : null}
      {!data.ready ? <ErrorNote>{t('admin.codes.notReady')}</ErrorNote> : null}

      <TableFrame minWidth="52rem">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.codes.cols.time')}</th>
              <th className={TH_STICKY}>{t('admin.codes.cols.number')}</th>
              <th className={TH_STICKY}>{t('admin.codes.cols.who')}</th>
              <th className={TH_STICKY}>{t('admin.codes.cols.purpose')}</th>
              <th className={TH_STICKY}>{t('admin.codes.cols.code')}</th>
              <th className={TH_STICKY}>{t('admin.codes.cols.status')}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length ? data.rows.map((row) => {
              // The database's clock (within_validity), not the server's render time.
              const valid = row.status === 'sent' && row.within_validity;
              const isNewest = newest.has(row.id);
              return (
                <tr key={row.id} className={TR_DENSE}>
                  <td className={`${TD_DENSE} u-tabular whitespace-nowrap`}>{formatKinshasa(row.created_at)}</td>
                  <td className={`${TD_DENSE} u-tabular whitespace-nowrap`}>
                    <a href={`https://wa.me/${row.phone}`} target="_blank" rel="noopener noreferrer" className="text-blue-deep hover:underline">+{row.phone}</a>
                  </td>
                  <td className={TD_DENSE}>{row.name || <span className="text-ink-45">{t('admin.codes.noName')}</span>}</td>
                  <td className={TD_DENSE}>{t(`admin.codes.purposes.${row.kind}`)}</td>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>
                    <span className={`u-tabular text-[1rem] font-bold tracking-[0.15em] ${valid && isNewest ? 'text-ink' : 'text-ink-45 line-through decoration-ink-25'}`}>{row.code}</span>
                    {valid && isNewest ? null : (
                      <span className="u-micro ml-2 text-ink-45">{t(isNewest ? 'admin.codes.expired' : 'admin.codes.replaced')}</span>
                    )}
                  </td>
                  <td className={TD_DENSE}>
                    {row.status === 'sent' ? (
                      <Chip tone="success">{t(row.channel === 'session' ? 'admin.codes.sentSession' : 'admin.codes.sentTemplate')}</Chip>
                    ) : (
                      <span title={row.error || undefined}><Chip tone="danger">{t('admin.codes.failed')}</Chip></span>
                    )}
                  </td>
                </tr>
              );
            }) : (
              <EmptyRow colSpan={6}>{t('admin.codes.empty', { minutes: CODE_LOG_SHOW_MINUTES })}</EmptyRow>
            )}
          </tbody>
        </table>
      </TableFrame>
    </div>
  );
}
