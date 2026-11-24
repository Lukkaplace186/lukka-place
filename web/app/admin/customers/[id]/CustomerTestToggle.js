'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n/client';

/** "Compte de test" for a customer: the agent page's box, same wording. */
export default function CustomerTestToggle({ isTest, action }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  function toggle(next) {
    startTransition(async () => {
      const result = await action(next);
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      showToast({ type: 'success', message: t(next ? 'admin.customerProfile.markedTest' : 'admin.customerProfile.unmarkedTest') });
      router.refresh();
    });
  }

  return (
    <label className="flex items-start gap-2.5 text-[0.8125rem] text-ink">
      <input
        type="checkbox"
        defaultChecked={Boolean(isTest)}
        disabled={pending}
        onChange={(event) => toggle(event.currentTarget.checked)}
        className="mt-0.5 h-4 w-4"
      />
      <span>
        <span className="font-semibold">{t('admin.customerProfile.testAccount')}</span>
        <span className="u-micro block text-ink-45">{t('admin.customerProfile.testAccountHint')}</span>
      </span>
    </label>
  );
}
