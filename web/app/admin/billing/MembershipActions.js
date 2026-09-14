'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n/client';
import { updateMembershipAction } from '../subscriptions/actions';

const BUTTON = 'u-press u-micro-strong inline-flex h-8 items-center rounded-md border border-line bg-surface px-2.5 text-ink hover:border-blue disabled:opacity-50';

/**
 * Renewal-desk actions on one membership: extend by 30 days (a goodwill or a
 * renewal agreed but not yet re-invoiced — it adds no ledger row), cancel, or
 * reactivate. A real renewal PAYMENT is recorded by assigning the plan again.
 */
export default function MembershipActions({ membershipId, active }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  function run(action, extra = {}, message) {
    startTransition(async () => {
      const formData = new FormData();
      formData.set('action', action);
      for (const [key, value] of Object.entries(extra)) formData.set(key, String(value));
      try {
        await updateMembershipAction(membershipId, formData);
        showToast({ type: 'success', message });
        router.refresh();
      } catch (err) {
        showToast({ type: 'error', message: err.message || t('errors.actionFailed') });
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      <button type="button" className={BUTTON} disabled={pending} onClick={() => run('extend', { days: 30 }, t('admin.billing.extended'))}>
        {t('admin.billing.extend30')}
      </button>
      {active ? (
        <button type="button" className={`${BUTTON} text-danger`} disabled={pending} onClick={() => run('cancel', {}, t('admin.billing.cancelled'))}>
          {t('admin.billing.cancel')}
        </button>
      ) : (
        <button type="button" className={BUTTON} disabled={pending} onClick={() => run('reactivate', {}, t('admin.billing.reactivated'))}>
          {t('admin.actions.reactivate')}
        </button>
      )}
    </div>
  );
}
