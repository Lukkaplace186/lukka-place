'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BadgeCheck, Building2, MoreHorizontal, PauseCircle, PlayCircle, ScanEye, Settings2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { Chip } from '../LeadRoutingUI';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../table/TableFrame';
import { reassignAgentVendorAction, updateAgentStatusAction } from './actions';
import { bulkUpdateAgentStatusAction } from './bulkActions';
import { assignBranchAction } from '../agencies/[id]/branchActions';
import { ImpersonateDialog } from '../ImpersonateButton';

const BUTTON =
  'u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-ink transition-colors hover:border-blue disabled:opacity-50';

/**
 * One page of agents with row selection, bulk Activer/Suspendre and per-row
 * quick actions. The page itself is fetched server-side (LIMIT/OFFSET); this
 * component only ever holds those ≤100 rows.
 *
 * Territory is shown but not edited here: the old list rendered a 24-commune
 * checkbox form in EVERY row, which is unusable past a few dozen agents.
 * Specialty vs coverage score differently in the matcher, so they are edited
 * on /admin/agents/[id] with both lists in view.
 *
 * `branchContext` ({vendorId, branches}) is passed on an agency's own page and
 * adds "move to branch" to the bulk bar — branches only exist within an agency.
 */
export default function AgentsTable({ rows, vendors, footer, branchContext = null, canImpersonate = false, sharedSession = false }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(() => new Set());
  const [vendorDialog, setVendorDialog] = useState(null);
  const [vendorId, setVendorId] = useState('');
  const [impersonating, setImpersonating] = useState(null);

  const pageIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggle(id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function run(action, { success, onDone } = {}) {
    startTransition(async () => {
      let result;
      try {
        result = await action();
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      // The per-row form actions return nothing on success and throw on failure.
      if (result === undefined) result = { ok: true, message: success };
      showToast({ type: result.ok ? 'success' : 'error', message: result.ok ? result.message || success : result.error });
      if (result.ok) {
        onDone?.();
        router.refresh();
      }
    });
  }

  function setStatus(id, status) {
    const formData = new FormData();
    formData.set('status', String(status));
    run(() => updateAgentStatusAction(id, formData), {
      success: status === 1 ? t('admin.agents.activated') : t('admin.agents.suspended'),
    });
  }

  function bulk(status) {
    const ids = [...selected];
    run(() => bulkUpdateAgentStatusAction(ids, status), { onDone: () => setSelected(new Set()) });
  }

  function moveToBranch(branchId) {
    const ids = [...selected];
    run(() => assignBranchAction(branchContext.vendorId, ids, branchId), { onDone: () => setSelected(new Set()) });
  }

  return (
    <div className="flex flex-col gap-2">
      {selected.size > 0 ? (
        <div className="u-card sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-card bg-ink px-4 py-2 text-white">
          <span className="u-micro-strong">{t('admin.agents.selectedCount', { count: selected.size })}</span>
          <button type="button" disabled={pending} onClick={() => bulk(1)} className="u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md bg-white/15 px-2.5 hover:bg-white/25">
            <PlayCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('admin.agents.bulkActivate')}
          </button>
          <button type="button" disabled={pending} onClick={() => bulk(0)} className="u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md bg-white/15 px-2.5 hover:bg-white/25">
            <PauseCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('admin.agents.bulkSuspend')}
          </button>
          {branchContext ? (
            <select
              aria-label={t('admin.branches.moveTo')}
              value=""
              disabled={pending}
              onChange={(event) => {
                const value = event.target.value;
                if (value) moveToBranch(value === 'none' ? null : value);
              }}
              className="u-micro-strong h-8 rounded-md border-0 bg-white/15 px-2 text-white hover:bg-white/25 [&>option]:text-ink"
            >
              <option value="">{t('admin.branches.moveTo')}</option>
              {branchContext.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              <option value="none">{t('admin.branches.removeFromBranch')}</option>
            </select>
          ) : null}
          <button type="button" onClick={() => setSelected(new Set())} className="u-micro ml-auto text-white/75 hover:text-white">
            {t('admin.agents.clearSelection')}
          </button>
        </div>
      ) : null}

      <TableFrame minWidth="76rem" footer={footer} busy={pending}>
        <thead>
          <tr>
            <th className={`${TH_STICKY} w-8`}>
              <input
                type="checkbox"
                aria-label={t('admin.agents.selectPage')}
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(pageIds))}
                className="h-4 w-4 accent-blue"
              />
            </th>
            <th className={TH_STICKY}>{t('admin.agents.name')}</th>
            <th className={TH_STICKY}>{t('admin.agents.phone')}</th>
            <th className={TH_STICKY}>{t('admin.agents.agency')}</th>
            <th className={TH_STICKY}>{t('admin.agents.territory')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.agents.listings')}</th>
            <th className={TH_STICKY}>{t('admin.agents.package')}</th>
            <th className={TH_STICKY}>{t('admin.agents.status')}</th>
            <th className={TH_STICKY} aria-label={t('admin.table.moreActions')} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={9}>{t('admin.agents.empty')}</EmptyRow>
          ) : (
            rows.map((agent) => (
              <tr key={agent.id} className={`${TR_DENSE} ${selected.has(agent.id) ? 'bg-blue-tint/40' : ''}`}>
                <td className={TD_DENSE}>
                  <input
                    type="checkbox"
                    aria-label={t('admin.agents.selectAgent', { name: agent.name })}
                    checked={selected.has(agent.id)}
                    onChange={() => toggle(agent.id)}
                    className="h-4 w-4 accent-blue"
                  />
                </td>
                <td className={TD_DENSE}>
                  <Link href={`/admin/agents/${agent.id}`} className="flex items-center gap-1 font-semibold text-ink hover:text-blue-deep hover:underline">
                    <span className="max-w-[14rem] truncate">{agent.name}</span>
                    {agent.verified ? (
                      <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 shrink-0 text-success" aria-label={t('admin.agents.verified')} />
                    ) : null}
                  </Link>
                  <div className="max-w-[14rem] truncate text-ink-45">{agent.email || '—'} · #{agent.id}</div>
                </td>
                <td className={TD_DENSE}>
                  <div className="u-tabular">{agent.phone ? `+${agent.phone}` : '—'}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {agent.verified ? <Chip tone="success">{t('admin.agents.verified')}</Chip> : <Chip tone="warning">{t('admin.agents.notVerified')}</Chip>}
                    {agent.verified && !agent.routingEnabled ? <Chip>{t('admin.agents.routingOff')}</Chip> : null}
                  </div>
                </td>
                <td className={TD_DENSE}>
                  {agent.agency || <span className="text-ink-35">{t('admin.agents.noAgency')}</span>}
                  {agent.branchName ? <div className="text-ink-45">{t('admin.branches.branchLabel', { name: agent.branchName })}</div> : null}
                </td>
                <td className={TD_DENSE}>
                  {agent.primary.length || agent.serviced.length ? (
                    <div className="flex max-w-[16rem] flex-wrap gap-1">
                      {agent.primary.slice(0, 2).map((commune) => <Chip key={`p-${commune}`} tone="blue">{commune}</Chip>)}
                      {agent.primary.length > 2 ? <Chip tone="blue">+{agent.primary.length - 2}</Chip> : null}
                      {agent.serviced.length ? <Chip>{t('admin.agents.coverageCount', { count: agent.serviced.length })}</Chip> : null}
                    </div>
                  ) : (
                    <span className="text-ink-35">{t('admin.agents.noTerritory')}</span>
                  )}
                </td>
                <td className={TD_DENSE_RIGHT}>
                  <span className="font-semibold text-ink">{agent.live}</span>
                  <span className="text-ink-45"> / {agent.total}{agent.limit != null ? ` · ${t('admin.agents.quota', { limit: agent.limit })}` : ''}</span>
                </td>
                <td className={TD_DENSE}>
                  {agent.packageTitle ? (
                    <>
                      <div className="text-ink">{agent.packageTitle}</div>
                      {agent.expireLabel ? <div className="text-ink-45">{t('admin.agents.until', { date: agent.expireLabel })}</div> : null}
                    </>
                  ) : (
                    <span className="text-ink-35">{t('admin.agents.noActiveSubscription')}</span>
                  )}
                </td>
                <td className={TD_DENSE}>
                  {agent.status === 1 ? <Chip tone="success">{t('admin.agents.statusActive')}</Chip> : <Chip tone="neutral">{t('admin.agents.statusSuspended')}</Chip>}
                </td>
                <td className={TD_DENSE}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className={BUTTON} aria-label={t('admin.table.moreActions')} disabled={pending}>
                        <MoreHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem asChild>
                        <Link href={`/admin/agents/${agent.id}`}>
                          <Settings2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                          {t('admin.agents.manage')}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => { setVendorId(agent.vendorId ? String(agent.vendorId) : ''); setVendorDialog(agent); }}>
                        <Building2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                        {t('admin.agents.changeAgency')}
                      </DropdownMenuItem>
                      {canImpersonate ? (
                        <DropdownMenuItem onSelect={() => setImpersonating(agent)}>
                          <ScanEye strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                          {t('admin.impersonation.button')}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuSeparator />
                      {agent.status === 1 ? (
                        <DropdownMenuItem onSelect={() => setStatus(agent.id, 0)}>
                          <PauseCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                          {t('admin.agents.suspend')}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => setStatus(agent.id, 1)}>
                          <PlayCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                          {t('admin.agents.activate')}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </TableFrame>

      {canImpersonate ? (
        <ImpersonateDialog
          open={Boolean(impersonating)}
          onOpenChange={(open) => { if (!open) setImpersonating(null); }}
          targetType="agent"
          targetId={impersonating?.id}
          targetLabel={impersonating?.name || ''}
          sharedSession={sharedSession}
        />
      ) : null}

      <Dialog open={Boolean(vendorDialog)} onOpenChange={(open) => { if (!open) setVendorDialog(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('admin.agents.changeAgencyTitle')}</DialogTitle>
            <DialogDescription>{vendorDialog?.name}</DialogDescription>
          </DialogHeader>
          <select
            value={vendorId}
            onChange={(event) => setVendorId(event.target.value)}
            className="u-focus-ring u-micro h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-ink"
          >
            <option value="">{t('admin.agents.noAgency')}</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>{vendor.username}</option>
            ))}
          </select>
          <DialogFooter>
            <button type="button" className={BUTTON} onClick={() => setVendorDialog(null)}>{t('common.actions.cancel')}</button>
            <button
              type="button"
              disabled={pending}
              className="u-press u-btn-primary inline-flex h-8 items-center rounded-md bg-blue px-3 text-sm font-semibold text-white hover:bg-blue-deep disabled:opacity-50"
              onClick={() => {
                const formData = new FormData();
                formData.set('vendor_id', vendorId);
                const id = vendorDialog.id;
                run(() => reassignAgentVendorAction(id, formData), {
                  success: t('admin.agents.agencyChanged'),
                  onDone: () => setVendorDialog(null),
                });
              }}
            >
              {t('common.actions.save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
