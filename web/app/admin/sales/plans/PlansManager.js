'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { Chip } from '../../LeadRoutingUI';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../../table/TableFrame';
import { savePlanAction } from '../actions';
import { BUTTON, INPUT } from '../styles';

export default function PlansManager({ plans, canManage }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(null); // null | 'new' | plan
  const [kind, setKind] = useState('subscription');

  function edit(plan) {
    setKind(plan === 'new' ? 'subscription' : plan.kind || 'subscription');
    setEditing(plan);
  }

  function submit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const id = editing === 'new' ? null : editing?.id;
    startTransition(async () => {
      let result;
      try {
        result = await savePlanAction(id, formData);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error });
      if (result?.ok) {
        setEditing(null);
        router.refresh();
      }
    });
  }

  const form = editing && editing !== 'new' ? editing : { currency: 'USD', active: true };

  return (
    <div className="flex flex-col gap-3">
      {canManage ? (
        <div>
          <button type="button" className={BUTTON} onClick={() => edit('new')}>
            <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('admin.sales.plans.add')}
          </button>
        </div>
      ) : null}

      <TableFrame minWidth="56rem">
        <thead>
          <tr>
            <th className={TH_STICKY}>{t('admin.sales.plans.name')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.sales.plans.onboardingBonus')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.sales.plans.subscriptionRate')}</th>
            <th className={TH_STICKY}>{t('admin.sales.plans.target')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.sales.plans.reps')}</th>
            {canManage ? <th className={TH_STICKY} aria-label={t('admin.table.moreActions')} /> : null}
          </tr>
        </thead>
        <tbody>
          {plans.length === 0 ? <EmptyRow colSpan={canManage ? 6 : 5}>{t('admin.sales.plans.empty')}</EmptyRow> : plans.map((plan) => (
            <tr key={plan.id} className={TR_DENSE}>
              <td className={TD_DENSE}>
                <span className="font-semibold text-ink">{plan.name}</span>
                {plan.active ? null : <span className="ml-1.5"><Chip>{t('admin.sales.plans.inactive')}</Chip></span>}
                <div className="text-ink-45">{t(`admin.sales.plans.kind.${plan.kind || 'subscription'}`)}</div>
              </td>
              {plan.kind === 'launch_milestones' ? (
                <td className={TD_DENSE} colSpan={3}>{t('admin.sales.plans.launchSummary')}</td>
              ) : (
                <>
                  <td className={`${TD_DENSE_RIGHT} u-tabular`}>{plan.onboardingLabel}</td>
                  <td className={`${TD_DENSE_RIGHT} u-tabular`}>{plan.subscription_rate} %</td>
                  <td className={TD_DENSE}>{plan.targetLabel || '—'}</td>
                </>
              )}
              <td className={TD_DENSE_RIGHT}>{plan.reps}</td>
              {canManage ? (
                <td className={TD_DENSE}>
                  <button type="button" className="u-press inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-45 hover:bg-canvas-alt hover:text-ink" aria-label={t('admin.sales.plans.edit')} onClick={() => edit(plan)}>
                    <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </TableFrame>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <form key={editing === 'new' ? 'new' : editing?.id ?? 'none'} onSubmit={submit} className="flex flex-col gap-3">
            <DialogHeader>
              <DialogTitle>{editing === 'new' ? t('admin.sales.plans.addTitle') : t('admin.sales.plans.editTitle')}</DialogTitle>
              <DialogDescription>{t('admin.sales.plans.formHint')}</DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1">
              <span className="u-micro-strong text-ink">{t('admin.sales.plans.kindLabel')}</span>
              <select name="kind" value={kind} onChange={(event) => setKind(event.target.value)} className={INPUT}>
                <option value="subscription">{t('admin.sales.plans.kind.subscription')}</option>
                <option value="launch_milestones">{t('admin.sales.plans.kind.launch_milestones')}</option>
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem]">
              <label className="flex flex-col gap-1">
                <span className="u-micro-strong text-ink">{t('admin.sales.plans.name')}</span>
                <input name="name" required maxLength={80} defaultValue={form.name || ''} className={INPUT} />
              </label>
              {kind === 'launch_milestones' ? null : (
                <label className="flex flex-col gap-1">
                  <span className="u-micro-strong text-ink">{t('admin.sales.plans.currency')}</span>
                  <input name="currency" required maxLength={3} defaultValue={form.currency || 'USD'} className={`${INPUT} uppercase`} />
                </label>
              )}
            </div>
            {kind === 'launch_milestones' ? (
              <div className="u-micro rounded-lg border border-line bg-canvas p-3 text-ink-70">
                <p className="font-semibold text-ink">{t('admin.sales.plans.launchTitle')}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>{t('admin.sales.plans.launchAcquisition')}</li>
                  <li>{t('admin.sales.plans.launchAdditional')}</li>
                  <li>{t('admin.sales.plans.launchQuality')}</li>
                  <li>{t('admin.sales.plans.launchQualified')}</li>
                </ul>
              </div>
            ) : null}
            <div className={`grid gap-3 sm:grid-cols-2 ${kind === 'launch_milestones' ? 'hidden' : ''}`}>
              <label className="flex flex-col gap-1">
                <span className="u-micro-strong text-ink">{t('admin.sales.plans.onboardingBonus')}</span>
                <input name="onboarding_bonus" inputMode="decimal" defaultValue={form.onboarding_bonus ?? '0'} className={INPUT} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="u-micro-strong text-ink">{t('admin.sales.plans.subscriptionRate')}</span>
                <input name="subscription_rate" inputMode="decimal" defaultValue={form.subscription_rate ?? '0'} className={INPUT} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="u-micro-strong text-ink">{t('admin.sales.plans.monthlyTarget')}</span>
                <input name="monthly_target" inputMode="numeric" defaultValue={form.monthly_target ?? '0'} className={INPUT} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="u-micro-strong text-ink">{t('admin.sales.plans.targetBonus')}</span>
                <input name="target_bonus" inputMode="decimal" defaultValue={form.target_bonus ?? '0'} className={INPUT} />
              </label>
            </div>
            <label className="u-micro inline-flex items-center gap-2 text-ink">
              <input type="checkbox" name="active" value="true" defaultChecked={form.active !== false} className="h-4 w-4 accent-blue" />
              {t('admin.sales.plans.activeLabel')}
            </label>
            <p className="u-micro text-ink-45">{t('admin.sales.plans.snapshotHint')}</p>
            <DialogFooter>
              <button type="button" className={BUTTON} onClick={() => setEditing(null)}>{t('common.actions.cancel')}</button>
              <button type="submit" className={`${BUTTON} border-blue text-blue-deep`} disabled={pending}>{t('admin.sales.save')}</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
