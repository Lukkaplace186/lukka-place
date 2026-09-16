'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Banknote, CheckCheck, CircleSlash, PlusCircle } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { PAYOUT_METHODS } from '@/lib/salesRules';
import { Chip } from '../../LeadRoutingUI';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../../table/TableFrame';
import { addAdjustmentAction, approveCommissionsAction, recordPayoutAction, voidCommissionAction } from '../actions';
import { BUTTON, INPUT } from '../styles';

/**
 * The commission ledger: select pending lines to approve, approved lines to
 * pay; add a manual adjustment; void a line with a reason. A payout is always
 * one currency — its dialog offers only the currencies with approved lines.
 * With a fortnight filter on, `scopeLines` holds that fortnight's approved
 * lines, and "pay" with nothing selected pays exactly those, not every
 * approved line the rep has.
 */
export default function CommissionLedger({ repId, rows, openTotals, canManage, today, defaultCurrency, footer, scopeLines = null, scopeLabel = null }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(() => new Set());
  const [dialog, setDialog] = useState(null); // 'payout' | 'adjustment' | {void: row}
  const [voidReason, setVoidReason] = useState('');

  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected]);
  const selectedPending = selectedRows.filter((row) => row.status === 'pending');
  const selectedApproved = selectedRows.filter((row) => row.status === 'approved');
  const approvedCurrencies = openTotals.filter((total) => total.status === 'approved').map((total) => total.currency);
  const selectedCurrencies = [...new Set(selectedApproved.map((row) => row.currency))];
  const scopeCurrencies = scopeLines ? [...new Set(scopeLines.map((line) => line.currency))] : null;
  const payoutCurrencies = selectedApproved.length ? selectedCurrencies : scopeCurrencies || approvedCurrencies;

  function toggle(id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function run(action, onDone) {
    startTransition(async () => {
      let result;
      try {
        result = await action();
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error });
      if (result?.ok) {
        setSelected(new Set());
        setDialog(null);
        onDone?.();
        router.refresh();
      }
    });
  }

  function submitPayout(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const currency = formData.get('currency');
    const chosen = selectedApproved.length ? selectedApproved : scopeLines || [];
    const ids = chosen.filter((row) => row.currency === currency).map((row) => row.id);
    run(() => recordPayoutAction(repId, ids, formData));
  }

  function submitAdjustment(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    run(() => addAdjustmentAction(repId, formData));
  }

  return (
    <div className="flex flex-col gap-2">
      {openTotals.length ? (
        <div className="flex flex-wrap gap-2">
          {openTotals.map((total) => (
            <span key={`${total.status}-${total.currency}`} className="u-micro rounded-full border border-line bg-surface px-3 py-1 text-ink-70">
              {t(`admin.sales.status.${total.status}`)} · <span className="u-tabular font-semibold text-ink">{total.label}</span> ({total.count})
            </span>
          ))}
        </div>
      ) : null}

      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BUTTON} disabled={pending || selectedPending.length === 0} onClick={() => run(() => approveCommissionsAction(repId, selectedPending.map((row) => row.id)))}>
            <CheckCheck strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('admin.sales.ledger.approveSelected', { count: selectedPending.length })}
          </button>
          <button type="button" className={BUTTON} disabled={pending || payoutCurrencies.length === 0 || selectedCurrencies.length > 1} onClick={() => setDialog('payout')}>
            <Banknote strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {selectedApproved.length
              ? t('admin.sales.ledger.paySelected', { count: selectedApproved.length })
              : scopeLines ? t('admin.sales.launch.fortnight.pay', { count: scopeLines.length }) : t('admin.sales.ledger.payApproved')}
          </button>
          <button type="button" className={BUTTON} disabled={pending} onClick={() => setDialog('adjustment')}>
            <PlusCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('admin.sales.ledger.addAdjustment')}
          </button>
          {selectedCurrencies.length > 1 ? <span className="u-micro self-center text-danger">{t('admin.sales.ledger.oneCurrency')}</span> : null}
        </div>
      ) : null}

      <TableFrame minWidth="64rem" footer={footer} busy={pending}>
        <thead>
          <tr>
            {canManage ? <th className={`${TH_STICKY} w-8`} aria-label={t('admin.agents.selectPage')} /> : null}
            <th className={TH_STICKY}>{t('admin.sales.ledger.colEarned')}</th>
            <th className={TH_STICKY}>{t('admin.sales.ledger.colSource')}</th>
            <th className={TH_STICKY}>{t('admin.sales.ledger.colDetail')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.sales.ledger.colAmount')}</th>
            <th className={TH_STICKY}>{t('admin.billing.colStatus')}</th>
            {canManage ? <th className={TH_STICKY} aria-label={t('admin.table.moreActions')} /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={canManage ? 7 : 5}>{t('admin.sales.ledger.empty')}</EmptyRow>
          ) : rows.map((row) => {
            const selectable = row.status === 'pending' || row.status === 'approved';
            return (
              <tr key={row.id} className={`${TR_DENSE} ${selected.has(row.id) ? 'bg-blue-tint/40' : ''}`}>
                {canManage ? (
                  <td className={TD_DENSE}>
                    {selectable ? (
                      <input type="checkbox" className="h-4 w-4 accent-blue" checked={selected.has(row.id)} onChange={() => toggle(row.id)} aria-label={t('admin.sales.ledger.selectLine', { id: row.id })} />
                    ) : null}
                  </td>
                ) : null}
                <td className={`${TD_DENSE} whitespace-nowrap`}>{row.earnedLabel}</td>
                <td className={TD_DENSE}>
                  <div className="font-semibold text-ink">{row.source}</div>
                  {row.account ? (
                    row.accountHref ? <Link href={row.accountHref} className="text-blue-deep hover:underline">{row.account}</Link> : <span className="text-ink-45">{row.account}</span>
                  ) : null}
                </td>
                <td className={`${TD_DENSE} max-w-[22rem] break-words text-ink-70`}>
                  {row.detail || '—'}
                  {row.clawbackDue ? (
                    <div className="mt-1 inline-flex items-center gap-1 font-semibold text-danger">
                      <AlertTriangle strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                      {t('admin.sales.ledger.clawbackDue')}
                    </div>
                  ) : null}
                  {row.status === 'void' && row.voidReason ? <div className="text-ink-45">{row.voidReason}</div> : null}
                </td>
                <td className={`${TD_DENSE_RIGHT} u-tabular font-semibold ${row.amount < 0 ? 'text-danger' : 'text-ink'}`}>{row.amountLabel}</td>
                <td className={TD_DENSE}><Chip tone={row.statusTone}>{row.statusLabel}</Chip></td>
                {canManage ? (
                  <td className={TD_DENSE}>
                    {selectable ? (
                      <button
                        type="button"
                        className="u-press inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-45 hover:bg-canvas-alt hover:text-danger"
                        aria-label={t('admin.sales.ledger.void')}
                        title={t('admin.sales.ledger.void')}
                        onClick={() => { setVoidReason(''); setDialog({ void: row }); }}
                      >
                        <CircleSlash strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </TableFrame>

      <Dialog open={dialog === 'payout'} onOpenChange={(open) => { if (!open) setDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submitPayout} className="flex flex-col gap-3">
            <DialogHeader>
              <DialogTitle>{t('admin.sales.ledger.payoutTitle')}</DialogTitle>
              <DialogDescription>
                {selectedApproved.length
                  ? t('admin.sales.ledger.payoutSelected', { count: selectedApproved.length })
                  : scopeLines ? t('admin.sales.launch.fortnight.payoutHint', { count: scopeLines.length, fortnight: scopeLabel || '' }) : t('admin.sales.ledger.payoutAll')}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="u-micro-strong text-ink">{t('admin.sales.plans.currency')}</span>
                <select name="currency" className={INPUT} defaultValue={payoutCurrencies[0]}>
                  {payoutCurrencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="u-micro-strong text-ink">{t('admin.sales.payouts.paidAt')}</span>
                <input type="date" name="paid_at" required defaultValue={today} max={today} className={INPUT} />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="u-micro-strong text-ink">{t('admin.sales.payouts.method')}</span>
              <input name="method" required maxLength={60} list="sales-payout-methods" placeholder={t('admin.sales.ledger.methodPlaceholder')} className={INPUT} />
              <datalist id="sales-payout-methods">
                {PAYOUT_METHODS.map((method) => <option key={method} value={method} />)}
              </datalist>
            </label>
            <label className="flex flex-col gap-1">
              <span className="u-micro-strong text-ink">{t('admin.sales.ledger.reference')}</span>
              <input name="reference" maxLength={120} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="u-micro-strong text-ink">{t('admin.sales.ledger.note')}</span>
              <input name="note" maxLength={500} className={INPUT} />
            </label>
            <DialogFooter>
              <button type="button" className={BUTTON} onClick={() => setDialog(null)}>{t('common.actions.cancel')}</button>
              <button type="submit" className={`${BUTTON} border-blue text-blue-deep`} disabled={pending}>{t('admin.sales.ledger.recordPayout')}</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'adjustment'} onOpenChange={(open) => { if (!open) setDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submitAdjustment} className="flex flex-col gap-3">
            <DialogHeader>
              <DialogTitle>{t('admin.sales.ledger.adjustmentTitle')}</DialogTitle>
              <DialogDescription>{t('admin.sales.ledger.adjustmentHint')}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="u-micro-strong text-ink">{t('admin.sales.ledger.colAmount')}</span>
                <input name="amount" required inputMode="decimal" placeholder="-25.00" className={INPUT} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="u-micro-strong text-ink">{t('admin.sales.plans.currency')}</span>
                <input name="currency" required maxLength={3} defaultValue={defaultCurrency} className={`${INPUT} uppercase`} />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="u-micro-strong text-ink">{t('admin.sales.ledger.note')}</span>
              <input name="note" required minLength={3} maxLength={500} className={INPUT} />
            </label>
            <DialogFooter>
              <button type="button" className={BUTTON} onClick={() => setDialog(null)}>{t('common.actions.cancel')}</button>
              <button type="submit" className={`${BUTTON} border-blue text-blue-deep`} disabled={pending}>{t('admin.sales.save')}</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(dialog?.void)} onOpenChange={(open) => { if (!open) setDialog(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('admin.sales.ledger.voidTitle')}</DialogTitle>
            <DialogDescription>{dialog?.void ? `${dialog.void.source} · ${dialog.void.amountLabel}` : ''}</DialogDescription>
          </DialogHeader>
          <input value={voidReason} onChange={(event) => setVoidReason(event.target.value)} maxLength={500} placeholder={t('admin.sales.ledger.voidReason')} className={INPUT} />
          <DialogFooter>
            <button type="button" className={BUTTON} onClick={() => setDialog(null)}>{t('common.actions.cancel')}</button>
            <button
              type="button"
              className={`${BUTTON} border-danger text-danger`}
              disabled={pending || voidReason.trim().length < 3}
              onClick={() => run(() => voidCommissionAction(repId, dialog.void.id, voidReason))}
            >
              {t('admin.sales.ledger.void')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
