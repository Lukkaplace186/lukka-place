'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, Pencil, Plus } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { archiveBranchAction, saveBranchAction } from './branchActions';

const BUTTON = 'u-press u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-ink hover:border-blue disabled:opacity-50';
const ICON_BUTTON = 'u-press inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-45 hover:bg-canvas-alt hover:text-ink disabled:opacity-50';
const INPUT = 'u-micro h-9 w-full rounded-lg border border-line bg-surface px-3 text-ink focus:border-blue focus:outline-none';
const CHIP = 'u-micro-strong inline-flex items-center gap-1.5 rounded-full border px-3 py-1';

/**
 * An agency's branches: filter the roster by branch, and (with agents.manage)
 * create, edit and archive them. Moving agents between branches happens in the
 * roster's own bulk bar, where the agents are selected.
 */
export default function BranchesPanel({ vendorId, basePath, branches, unassigned, communes, activeBranch, canManage }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(null); // null | 'new' | branch
  const [archiving, setArchiving] = useState(null);

  function finish(result, onOk) {
    showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error });
    if (result?.ok) {
      onOk();
      router.refresh();
    }
  }

  function submit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const branchId = editing === 'new' ? null : editing?.id;
    startTransition(async () => {
      let result;
      try {
        result = await saveBranchAction(vendorId, branchId, formData);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      finish(result, () => setEditing(null));
    });
  }

  function archive() {
    const branchId = archiving?.id;
    startTransition(async () => {
      let result;
      try {
        result = await archiveBranchAction(vendorId, branchId);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      finish(result, () => setArchiving(null));
    });
  }

  const chipClass = (active) => `${CHIP} ${active ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-surface text-ink-70 hover:border-blue'}`;
  const form = editing === 'new' ? {} : editing || {};

  return (
    <section className="u-card flex flex-col gap-3 rounded-card bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="u-title-card text-ink">{t('admin.branches.title')}</h2>
          <p className="u-micro text-ink-45">{t('admin.branches.subtitle')}</p>
        </div>
        {canManage ? (
          <button type="button" className={BUTTON} onClick={() => setEditing('new')}>
            <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('admin.branches.add')}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href={basePath} scroll={false} className={chipClass(!activeBranch)} aria-current={!activeBranch ? 'page' : undefined}>
          {t('admin.branches.allAgents')}
        </Link>
        {branches.map((branch) => (
          <Link
            key={branch.id}
            href={`${basePath}?branch=${branch.id}`}
            scroll={false}
            className={chipClass(activeBranch === String(branch.id))}
            aria-current={activeBranch === String(branch.id) ? 'page' : undefined}
          >
            {branch.name}
            <span className="u-tabular text-ink-45">{branch.agents}</span>
          </Link>
        ))}
        <Link href={`${basePath}?branch=none`} scroll={false} className={chipClass(activeBranch === 'none')} aria-current={activeBranch === 'none' ? 'page' : undefined}>
          {t('admin.branches.noBranch')}
          <span className="u-tabular text-ink-45">{unassigned}</span>
        </Link>
      </div>

      {branches.length === 0 ? (
        <p className="u-micro text-ink-45">{t('admin.branches.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {branches.map((branch) => (
            <li key={branch.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="u-micro-strong text-ink">{branch.name}</div>
                <div className="u-micro text-ink-45">
                  {[branch.commune, branch.phone ? `+${branch.phone}` : null, t('admin.branches.agentCount', { count: branch.agents, active: branch.active_agents })]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              {canManage ? (
                <div className="flex shrink-0 gap-1">
                  <button type="button" className={ICON_BUTTON} disabled={pending} onClick={() => setEditing(branch)} aria-label={t('admin.branches.edit')}>
                    <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                  </button>
                  <button type="button" className={ICON_BUTTON} disabled={pending} onClick={() => setArchiving(branch)} aria-label={t('admin.branches.archive')}>
                    <Archive strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <form key={editing === 'new' ? 'new' : editing?.id ?? 'none'} onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{editing === 'new' ? t('admin.branches.addTitle') : t('admin.branches.editTitle')}</DialogTitle>
              <DialogDescription>{t('admin.branches.formHint')}</DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1">
              <span className="u-micro-strong text-ink">{t('admin.branches.name')}</span>
              <input name="name" required maxLength={80} defaultValue={form.name || ''} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="u-micro-strong text-ink">{t('admin.branches.commune')}</span>
              <select name="commune" defaultValue={form.commune || ''} className={INPUT} disabled={communes.length === 0 && !form.commune}>
                <option value="">{t('admin.branches.communeNone')}</option>
                {form.commune && !communes.includes(form.commune) ? <option value={form.commune}>{form.commune}</option> : null}
                {communes.map((commune) => <option key={commune} value={commune}>{commune}</option>)}
              </select>
              {communes.length === 0 ? <span className="u-micro text-ink-45">{t('admin.branches.communesUnavailable')}</span> : null}
            </label>
            <label className="flex flex-col gap-1">
              <span className="u-micro-strong text-ink">{t('admin.branches.phone')}</span>
              <input name="phone" inputMode="tel" defaultValue={form.phone ? `+${form.phone}` : ''} className={INPUT} placeholder="+243…" />
            </label>
            <DialogFooter>
              <button type="button" className={BUTTON} onClick={() => setEditing(null)}>{t('common.actions.cancel')}</button>
              <button type="submit" className={`${BUTTON} border-blue text-blue-deep`} disabled={pending}>{t('admin.branches.save')}</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={archiving !== null} onOpenChange={(open) => { if (!open) setArchiving(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('admin.branches.archiveTitle')}</DialogTitle>
            <DialogDescription>{t('admin.branches.archiveConfirm', { name: archiving?.name || '', count: archiving?.agents ?? 0 })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className={BUTTON} onClick={() => setArchiving(null)}>{t('common.actions.cancel')}</button>
            <button type="button" className={`${BUTTON} border-danger text-danger`} disabled={pending} onClick={archive}>{t('admin.branches.archive')}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
