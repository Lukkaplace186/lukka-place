'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, UserPlus } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { saveRepAction } from './actions';
import { BUTTON, INPUT } from './styles';

/** Create or edit a rep: identity, plan, status, and the console account they sign in with. */
export default function RepDialog({ rep = null, plans, accounts }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      let result;
      try {
        result = await saveRepAction(rep?.id ?? null, formData);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error });
      if (result?.ok) {
        setOpen(false);
        if (!rep && result.id) router.push(`/admin/sales/${result.id}`);
        else router.refresh();
      }
    });
  }

  // An account already linked to ANOTHER rep is not offered.
  const accountOptions = accounts.filter((account) => account.rep_id == null || account.rep_id === rep?.id);

  return (
    <>
      <button type="button" className={BUTTON} onClick={() => setOpen(true)}>
        {rep ? <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" /> : <UserPlus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />}
        {rep ? t('admin.sales.reps.edit') : t('admin.sales.reps.add')}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} className="flex flex-col gap-3">
            <DialogHeader>
              <DialogTitle>{rep ? t('admin.sales.reps.editTitle') : t('admin.sales.reps.addTitle')}</DialogTitle>
              <DialogDescription>{t('admin.sales.reps.formHint')}</DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1">
              <span className="u-micro-strong text-ink">{t('admin.sales.reps.name')}</span>
              <input name="full_name" required maxLength={120} defaultValue={rep?.full_name || ''} className={INPUT} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="u-micro-strong text-ink">{t('admin.sales.reps.phone')}</span>
                <input name="phone" inputMode="tel" defaultValue={rep?.phone ? `+${rep.phone}` : ''} placeholder="+243…" className={INPUT} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="u-micro-strong text-ink">{t('admin.sales.reps.email')}</span>
                <input name="email" type="email" maxLength={200} defaultValue={rep?.email || ''} className={INPUT} />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="u-micro-strong text-ink">{t('admin.sales.reps.plan')}</span>
              <select name="plan_id" defaultValue={rep?.plan_id ? String(rep.plan_id) : ''} className={INPUT}>
                <option value="">{t('admin.sales.reps.noPlan')}</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>{plan.name}{plan.active ? '' : ` (${t('admin.sales.plans.inactive')})`}</option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="u-micro-strong text-ink">{t('admin.sales.reps.status')}</span>
                <select name="status" defaultValue={rep?.status || 'active'} className={INPUT}>
                  <option value="active">{t('admin.sales.reps.statusActive')}</option>
                  <option value="inactive">{t('admin.sales.reps.statusInactive')}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="u-micro-strong text-ink">{t('admin.sales.reps.account')}</span>
                <select name="admin_user_id" defaultValue={rep?.admin_user_id ? String(rep.admin_user_id) : ''} className={INPUT}>
                  <option value="">{t('admin.sales.reps.noAccount')}</option>
                  {accountOptions.map((account) => <option key={account.id} value={account.id}>{account.full_name}</option>)}
                </select>
              </label>
            </div>
            <p className="u-micro text-ink-45">{t('admin.sales.reps.accountHint')}</p>
            <DialogFooter>
              <button type="button" className={BUTTON} onClick={() => setOpen(false)}>{t('common.actions.cancel')}</button>
              <button type="submit" className={`${BUTTON} border-blue text-blue-deep`} disabled={pending}>{t('admin.sales.save')}</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
