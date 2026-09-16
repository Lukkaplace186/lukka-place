'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BadgeCheck, Plus, X } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import AgentPicker from '../../AgentPicker';
import { Chip } from '../../LeadRoutingUI';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../../table/TableFrame';
import { assignAgentsAction, endAssignmentAction } from '../actions';
import { BUTTON, INPUT } from '../styles';

/**
 * The agents a rep looks after. Adding one asks from when to credit the rep:
 * an agent they signed up last month is only credited if the date says so —
 * nothing before it earns a commission.
 */
export default function RepAccounts({ repId, rows, canManage, today, footer }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [agent, setAgent] = useState(null);
  const [creditFrom, setCreditFrom] = useState(today);
  const [pickerKey, setPickerKey] = useState(0);

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
        onDone?.();
        router.refresh();
      }
    });
  }

  function add() {
    if (!agent?.id) return;
    run(() => assignAgentsAction(repId, [agent.id], creditFrom), () => {
      setAgent(null);
      setPickerKey((key) => key + 1);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {canManage ? (
        <div className="u-card flex flex-wrap items-end gap-3 rounded-card bg-surface p-4">
          <div className="min-w-[16rem] flex-1">
            <span className="u-micro-strong mb-1 block text-ink">{t('admin.sales.accounts.addAgent')}</span>
            <AgentPicker key={pickerKey} onSelect={setAgent} placeholder={t('admin.sales.accounts.searchAgent')} />
          </div>
          <label className="flex flex-col gap-1">
            <span className="u-micro-strong text-ink">{t('admin.sales.accounts.creditFrom')}</span>
            <input type="date" value={creditFrom} max={today} onChange={(event) => setCreditFrom(event.target.value)} className={INPUT} />
          </label>
          <button type="button" className={`${BUTTON} border-blue text-blue-deep`} disabled={pending || !agent?.id} onClick={add}>
            <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('admin.sales.accounts.assign')}
          </button>
          <p className="u-micro w-full text-ink-45">{t('admin.sales.accounts.creditHint')}</p>
        </div>
      ) : null}

      <TableFrame minWidth="52rem" footer={footer} busy={pending}>
        <thead>
          <tr>
            <th className={TH_STICKY}>{t('admin.agents.name')}</th>
            <th className={TH_STICKY}>{t('admin.agents.status')}</th>
            <th className={TH_STICKY}>{t('admin.agents.package')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.sales.colLive')}</th>
            <th className={TH_STICKY}>{t('admin.sales.accounts.creditFrom')}</th>
            {canManage ? <th className={TH_STICKY} aria-label={t('admin.table.moreActions')} /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={canManage ? 6 : 5}>{t('admin.sales.accounts.empty')}</EmptyRow>
          ) : rows.map((row) => (
            <tr key={row.agentId} className={TR_DENSE}>
              <td className={TD_DENSE}>
                <Link href={`/admin/agents/${row.agentId}`} className="inline-flex items-center gap-1 font-semibold text-ink hover:text-blue-deep hover:underline">
                  {row.name}
                  {row.verified ? <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 text-success" aria-label={t('admin.agents.verified')} /> : null}
                </Link>
                <div className="u-tabular text-ink-45">{row.phone || '—'}</div>
              </td>
              <td className={TD_DENSE}>
                <div className="flex flex-wrap gap-1">
                  {row.verified ? <Chip tone="success">{t('admin.agents.verified')}</Chip> : <Chip tone="warning">{t('admin.agents.notVerified')}</Chip>}
                  {row.active ? null : <Chip>{t('admin.agents.statusSuspended')}</Chip>}
                </div>
              </td>
              <td className={TD_DENSE}>{row.plan || <span className="text-ink-35">{t('admin.agents.noActiveSubscription')}</span>}</td>
              <td className={TD_DENSE_RIGHT}>{row.liveListings}</td>
              <td className={`${TD_DENSE} whitespace-nowrap`}>{row.creditFrom}</td>
              {canManage ? (
                <td className={TD_DENSE}>
                  <button
                    type="button"
                    className="u-press inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-45 hover:bg-canvas-alt hover:text-danger disabled:opacity-50"
                    disabled={pending}
                    aria-label={t('admin.sales.accounts.unassign')}
                    title={t('admin.sales.accounts.unassign')}
                    onClick={() => run(() => endAssignmentAction(repId, row.agentId))}
                  >
                    <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </TableFrame>
    </div>
  );
}
