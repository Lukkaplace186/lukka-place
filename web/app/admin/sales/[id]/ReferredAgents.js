'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BadgeCheck, CircleSlash, RotateCcw } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { Chip } from '../../LeadRoutingUI';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../../table/TableFrame';
import AttributionDialog from '../AttributionDialog';
import { setAgentValidationAction } from '../actions';
import { BUTTON, INPUT } from '../styles';

const VALIDATION_TONE = { pending: 'warning', validated: 'success', rejected: 'danger' };

/**
 * The agents a rep brought in, one row each: how they came, listings credited,
 * qualified or not, and LukkaPlace's validation. Only validated qualified
 * agents count towards what is payable; `sales.manage` validates, rejects
 * (with a reason) or moves an agent to another rep.
 */
export default function ReferredAgents({ repId, rows, canManage, reps, today, footer }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');

  function run(action) {
    startTransition(async () => {
      let result;
      try {
        result = await action();
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error });
      if (result?.ok) {
        setRejecting(null);
        router.refresh();
      }
    });
  }

  const columns = canManage ? 7 : 6;

  return (
    <>
      <TableFrame minWidth="64rem" footer={footer} busy={pending}>
        <thead>
          <tr>
            <th className={TH_STICKY}>{t('admin.sales.launch.agents.colAgent')}</th>
            <th className={TH_STICKY}>{t('admin.sales.launch.agents.colSource')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.sales.launch.agents.colListings')}</th>
            <th className={TH_STICKY}>{t('admin.sales.launch.agents.colQualified')}</th>
            <th className={TH_STICKY}>{t('admin.sales.launch.agents.colValidation')}</th>
            <th className={TH_STICKY}>{t('admin.sales.launch.agents.colRegistered')}</th>
            {canManage ? <th className={TH_STICKY} aria-label={t('admin.table.moreActions')} /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={columns}>{t('admin.sales.launch.agents.empty')}</EmptyRow> : rows.map((row) => (
            <tr key={row.agentId} className={TR_DENSE}>
              <td className={TD_DENSE}>
                <Link href={`/admin/agents/${row.agentId}`} className="font-semibold text-ink hover:text-blue-deep hover:underline">{row.name}</Link>
                <div className="text-ink-45">
                  {row.phone || '—'}
                  {row.verified ? null : <span className="ml-1.5"><Chip tone="warning">{t('admin.sales.launch.agents.unverified')}</Chip></span>}
                  {row.profileOk ? null : <span className="ml-1.5"><Chip>{t('admin.sales.launch.agents.profileIncomplete')}</Chip></span>}
                </div>
              </td>
              <td className={TD_DENSE}>
                {row.sourceLabel}
                {row.code ? <div className="u-ref text-ink-45">{row.code}</div> : null}
              </td>
              <td className={TD_DENSE_RIGHT}>
                <span className="font-semibold text-ink">{row.credited}</span>
                <span className="text-ink-45"> / {row.listingsTotal}</span>
                {row.listingsBefore > 0 ? <div className="mt-0.5"><Chip tone="warning">{t('admin.sales.launch.agents.before', { count: row.listingsBefore })}</Chip></div> : null}
              </td>
              <td className={TD_DENSE}>
                {row.qualified
                  ? <Chip tone="success">{t('admin.sales.launch.agents.qualified')}</Chip>
                  : <span className="text-ink-45">{t('admin.sales.launch.agents.missing', { count: Math.max(0, 3 - row.credited) })}</span>}
                {row.qualifiedAt ? <div className="text-ink-45">{row.qualifiedAt}</div> : null}
              </td>
              <td className={TD_DENSE}>
                <Chip tone={VALIDATION_TONE[row.validation] || 'neutral'}>{t(`admin.sales.launch.validation.${row.validation}`)}</Chip>
                {row.rejectionReason ? <div className="max-w-[16rem] break-words text-ink-45">{row.rejectionReason}</div> : null}
              </td>
              <td className={`${TD_DENSE} whitespace-nowrap`}>{row.registeredAt}</td>
              {canManage ? (
                <td className={TD_DENSE}>
                  <div className="flex items-center gap-1">
                    {row.validation !== 'validated' ? (
                      <button
                        type="button"
                        className="u-press inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-45 hover:bg-canvas-alt hover:text-success"
                        aria-label={t('admin.sales.launch.validation.validate')}
                        title={t('admin.sales.launch.validation.validate')}
                        disabled={pending}
                        onClick={() => run(() => setAgentValidationAction(repId, row.agentId, 'validated'))}
                      >
                        <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                      </button>
                    ) : null}
                    {row.validation !== 'rejected' ? (
                      <button
                        type="button"
                        className="u-press inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-45 hover:bg-canvas-alt hover:text-danger"
                        aria-label={t('admin.sales.launch.validation.reject')}
                        title={t('admin.sales.launch.validation.reject')}
                        disabled={pending}
                        onClick={() => { setReason(''); setRejecting(row); }}
                      >
                        <CircleSlash strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                      </button>
                    ) : null}
                    {row.validation !== 'pending' ? (
                      <button
                        type="button"
                        className="u-press inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-45 hover:bg-canvas-alt hover:text-ink"
                        aria-label={t('admin.sales.launch.validation.reopen')}
                        title={t('admin.sales.launch.validation.reopen')}
                        disabled={pending}
                        onClick={() => run(() => setAgentValidationAction(repId, row.agentId, 'pending'))}
                      >
                        <RotateCcw strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                      </button>
                    ) : null}
                    <AttributionDialog
                      compact
                      agentId={row.agentId}
                      agentLabel={row.name}
                      currentRepId={repId}
                      currentRepName={row.repName}
                      reps={reps}
                      today={today}
                    />
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </TableFrame>

      <Dialog open={Boolean(rejecting)} onOpenChange={(open) => { if (!open) setRejecting(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('admin.sales.launch.validation.rejectTitle')}</DialogTitle>
            <DialogDescription>{rejecting ? t('admin.sales.launch.validation.rejectHint', { agent: rejecting.name }) : ''}</DialogDescription>
          </DialogHeader>
          <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder={t('admin.sales.ledger.voidReason')} className={INPUT} />
          <DialogFooter>
            <button type="button" className={BUTTON} onClick={() => setRejecting(null)}>{t('common.actions.cancel')}</button>
            <button
              type="button"
              className={`${BUTTON} border-danger text-danger`}
              disabled={pending || reason.trim().length < 3}
              onClick={() => run(() => setAgentValidationAction(repId, rejecting.agentId, 'rejected', reason))}
            >
              {t('admin.sales.launch.validation.reject')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
