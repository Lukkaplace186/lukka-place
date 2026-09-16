'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CircleSlash } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { Chip } from '../../LeadRoutingUI';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../../table/TableFrame';
import { excludeCreditAction } from '../actions';
import { BUTTON, INPUT } from '../styles';

const STATE_TONE = { live: 'success', closed: 'blue', rejected: 'danger', deleted: 'danger', offline: 'warning', excluded: 'neutral' };

/**
 * Listings credited to a rep: when each was confirmed, where it stands today,
 * and its day-30 verdict once it has one. `sales.manage` can exclude one
 * (fraud or a duplicate found later) — with a reason, and a recount follows.
 */
export default function ListingCredits({ repId, rows, canManage, footer }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [excluding, setExcluding] = useState(null);
  const [reason, setReason] = useState('');

  function exclude() {
    startTransition(async () => {
      let result;
      try {
        result = await excludeCreditAction(repId, excluding.id, reason);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error });
      if (result?.ok) {
        setExcluding(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      <TableFrame minWidth="56rem" footer={footer} busy={pending}>
        <thead>
          <tr>
            <th className={TH_STICKY}>{t('admin.sales.launch.credits.colListing')}</th>
            <th className={TH_STICKY}>{t('admin.sales.launch.credits.colAgent')}</th>
            <th className={TH_STICKY}>{t('admin.sales.launch.credits.colConfirmed')}</th>
            <th className={TH_STICKY}>{t('admin.sales.launch.credits.colNow')}</th>
            <th className={TH_STICKY}>{t('admin.sales.launch.credits.colDay30')}</th>
            {canManage ? <th className={TH_STICKY} aria-label={t('admin.table.moreActions')} /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={canManage ? 6 : 5}>{t('admin.sales.launch.credits.empty')}</EmptyRow> : rows.map((row) => (
            <tr key={row.id} className={TR_DENSE}>
              <td className={TD_DENSE}>
                {canManage && row.stateNow !== 'deleted'
                  ? <Link href={`/admin/listings/${row.propertyId}`} className="font-semibold text-ink hover:text-blue-deep hover:underline">{row.title || `#${row.propertyId}`}</Link>
                  : <span className="font-semibold text-ink">{row.title || `#${row.propertyId}`}</span>}
                {row.excludedReason ? <div className="max-w-[18rem] break-words text-ink-45">{row.excludedReason}</div> : null}
              </td>
              <td className={TD_DENSE}>{row.agentName || '—'}</td>
              <td className={`${TD_DENSE} whitespace-nowrap`}>{row.confirmedAt}</td>
              <td className={TD_DENSE}><Chip tone={STATE_TONE[row.stateNow] || 'neutral'}>{t(`admin.sales.launch.credits.state.${row.stateNow}`)}</Chip></td>
              <td className={TD_DENSE}>
                {row.day30State
                  ? <Chip tone={row.day30Valid ? 'success' : 'danger'}>{t(`admin.sales.launch.credits.state.${row.day30State}`)}</Chip>
                  : <span className="text-ink-45">{t('admin.sales.launch.credits.dueOn', { date: row.day30Due })}</span>}
              </td>
              {canManage ? (
                <td className={TD_DENSE}>
                  {row.stateNow !== 'excluded' ? (
                    <button
                      type="button"
                      className="u-press inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-45 hover:bg-canvas-alt hover:text-danger"
                      aria-label={t('admin.sales.launch.credits.exclude')}
                      title={t('admin.sales.launch.credits.exclude')}
                      onClick={() => { setReason(''); setExcluding(row); }}
                    >
                      <CircleSlash strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                    </button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </TableFrame>

      <Dialog open={Boolean(excluding)} onOpenChange={(open) => { if (!open) setExcluding(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('admin.sales.launch.credits.excludeTitle')}</DialogTitle>
            <DialogDescription>{t('admin.sales.launch.credits.excludeHint')}</DialogDescription>
          </DialogHeader>
          <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder={t('admin.sales.ledger.voidReason')} className={INPUT} />
          <DialogFooter>
            <button type="button" className={BUTTON} onClick={() => setExcluding(null)}>{t('common.actions.cancel')}</button>
            <button type="button" className={`${BUTTON} border-danger text-danger`} disabled={pending || reason.trim().length < 3} onClick={exclude}>
              {t('admin.sales.launch.credits.exclude')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
