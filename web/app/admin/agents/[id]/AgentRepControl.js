'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HandCoins } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { assignAgentsAction, endAssignmentAction } from '../../sales/actions';

const CONTROL = 'u-micro h-8 rounded-md border border-line bg-surface px-2 text-ink focus:border-blue focus:outline-none';
const BUTTON = 'u-press u-micro-strong inline-flex h-8 items-center rounded-md border border-line bg-surface px-2.5 text-ink hover:border-blue disabled:opacity-50';

/** Which sales rep looks after this agent — shown to everyone, changed by `sales.manage`. */
export default function AgentRepControl({ agentId, assignment, reps, canManage, today }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [repId, setRepId] = useState(assignment ? String(assignment.repId) : '');
  const [creditFrom, setCreditFrom] = useState(today);

  function run(action) {
    startTransition(async () => {
      let result;
      try {
        result = await action();
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error });
      if (result?.ok) router.refresh();
    });
  }

  return (
    <div className="u-micro inline-flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1 text-ink-70">
      <HandCoins strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-45" />
      {assignment ? (
        <span>
          {t('admin.sales.agentRep.current')}{' '}
          <Link href={`/admin/sales/${assignment.repId}`} className="font-semibold text-blue-deep hover:underline">{assignment.repName}</Link>
          <span className="text-ink-45"> · {t('admin.sales.agentRep.since', { date: assignment.since })}</span>
        </span>
      ) : (
        <span>{t('admin.sales.agentRep.none')}</span>
      )}
      {canManage ? (
        <>
          <select value={repId} onChange={(event) => setRepId(event.target.value)} className={CONTROL} aria-label={t('admin.sales.agentRep.choose')}>
            <option value="">{t('admin.sales.agentRep.choose')}</option>
            {reps.map((rep) => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
          </select>
          <input type="date" value={creditFrom} max={today} onChange={(event) => setCreditFrom(event.target.value)} className={CONTROL} aria-label={t('admin.sales.accounts.creditFrom')} />
          <button
            type="button"
            className={BUTTON}
            disabled={pending || !repId || String(assignment?.repId) === repId}
            onClick={() => run(() => assignAgentsAction(repId, [agentId], creditFrom))}
          >
            {t('admin.sales.accounts.assign')}
          </button>
          {assignment ? (
            <button type="button" className={`${BUTTON} text-danger`} disabled={pending} onClick={() => run(() => endAssignmentAction(assignment.repId, agentId))}>
              {t('admin.sales.accounts.unassign')}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
