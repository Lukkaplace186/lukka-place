'use client';

import { useTransition } from 'react';
import { useT } from '@/lib/i18n/client';
import { exitDemoAction, openDemoSideAction } from '@/app/admin/demo/actions';

const BUTTON = 'u-press u-micro-strong rounded-md bg-white px-3 py-1.5 text-ink hover:bg-white/90 disabled:opacity-60';

/** Switch to the other side of the pair, or leave the demo. Full navigations: cookies change. */
export default function DemoBannerActions({ pairId, switchTo }) {
  const t = useT();
  const [pending, startTransition] = useTransition();

  function go(action) {
    startTransition(async () => {
      let result;
      try {
        result = await action();
      } catch {
        result = null;
      }
      window.location.assign(result?.ok && result.redirectTo ? result.redirectTo : '/admin/demo');
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {switchTo ? (
        <button type="button" disabled={pending} className={BUTTON} onClick={() => go(() => openDemoSideAction(pairId, switchTo))}>
          {t(switchTo === 'agent' ? 'common.demo.openAgent' : 'common.demo.openCustomer')}
        </button>
      ) : null}
      <button type="button" disabled={pending} className={BUTTON} onClick={() => go(() => exitDemoAction())}>
        {t('common.demo.exit')}
      </button>
    </div>
  );
}
