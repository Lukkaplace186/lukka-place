'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n/client';
import { setDirectRoutingAction } from './actions';

/**
 * Direct wa.me routing on/off for one agent. Only rendered for an agent with a
 * verified number — an unverified one routes central regardless, and the page
 * says so in words instead of offering a switch that could not take effect.
 */
export default function RoutingToggle({ agentId, agentName, enabled }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      let result;
      try {
        result = await setDirectRoutingAction(agentId, !enabled);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      showToast({ type: result.ok ? 'success' : 'error', message: result.ok ? result.message : result.error });
      if (result.ok) router.refresh();
    });
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={t('admin.agentPerformance.toggleLabel', { name: agentName || `#${agentId}` })}
      onClick={toggle}
      disabled={pending}
      className="u-press inline-flex items-center gap-2 disabled:opacity-50"
    >
      <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${enabled ? 'bg-green' : 'bg-canvas-deep'}`}>
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-[1.125rem]' : 'translate-x-0.5'}`}
        />
      </span>
      <span className="u-micro-strong text-ink">
        {enabled ? t('admin.agentPerformance.direct') : t('admin.agentPerformance.central')}
      </span>
    </button>
  );
}
