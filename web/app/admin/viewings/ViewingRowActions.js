'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n/client';
import { nudgeViewingAction, reassignViewingAction, scheduleViewingAction } from './actions';

const CONTROL = 'u-micro min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-ink';
const BUTTON =
  'u-press u-micro-strong shrink-0 rounded-md border border-line bg-surface px-2.5 py-1.5 text-ink transition-colors hover:border-blue disabled:cursor-not-allowed disabled:opacity-50';

/**
 * The manual overrides on one viewing request: reassign to a verified agent,
 * pin the appointment time, and — for a request an agent is sitting on —
 * resend their alert. `agents` is already filtered to agents a lead can
 * legally be routed to; the engine re-checks that on every call.
 */
export default function ViewingRowActions({ viewingRequestId, agents, currentAgentId, canNudge }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [agentId, setAgentId] = useState('');
  const [when, setWhen] = useState('');

  function run(action, reset) {
    startTransition(async () => {
      let result;
      try {
        result = await action();
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      if (!result?.ok) {
        showToast({ type: 'error', message: result?.error || t('admin.viewings.actionFailed') });
        return;
      }
      showToast({ type: 'success', message: result.message });
      if (reset) reset();
      router.refresh();
    });
  }

  const selectable = agents.filter((agent) => agent.id !== currentAgentId);

  return (
    <div className="flex min-w-[16rem] flex-col gap-1.5">
      <form
        className="flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!agentId) return;
          run(() => reassignViewingAction(viewingRequestId, Number(agentId)), () => setAgentId(''));
        }}
      >
        <select
          aria-label={t('admin.viewings.reassignTo')}
          value={agentId}
          onChange={(event) => setAgentId(event.target.value)}
          className={CONTROL}
          disabled={pending || selectable.length === 0}
        >
          <option value="">
            {selectable.length ? t('admin.viewings.reassignTo') : t('admin.viewings.noRoutableAgents')}
          </option>
          {selectable.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name || `#${agent.id}`}
            </option>
          ))}
        </select>
        <button type="submit" className={BUTTON} disabled={pending || !agentId}>
          {t('admin.viewings.reassign')}
        </button>
      </form>

      <form
        className="flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!when) return;
          run(() => scheduleViewingAction(viewingRequestId, when), () => setWhen(''));
        }}
      >
        <input
          type="datetime-local"
          aria-label={t('admin.viewings.timeLabel')}
          value={when}
          onChange={(event) => setWhen(event.target.value)}
          className={CONTROL}
          disabled={pending}
        />
        <button type="submit" className={BUTTON} disabled={pending || !when}>
          {t('admin.viewings.setTime')}
        </button>
      </form>

      {canNudge ? (
        <button type="button" className={BUTTON} disabled={pending} onClick={() => run(() => nudgeViewingAction(viewingRequestId))}>
          {t('admin.viewings.nudge')}
        </button>
      ) : null}
    </div>
  );
}
