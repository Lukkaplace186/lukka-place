'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bookmark, Download, Trash2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { deleteViewAction, saveViewAction } from '../savedViewsActions';

const BUTTON =
  'u-press u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-ink transition-colors hover:border-blue disabled:opacity-50';

/**
 * Saved views + CSV export for a table toolbar. The export link carries the
 * table's current filters (never its page), so "export" means "this filtered
 * list", up to the export cap.
 */
export default function ViewTools({ path, query, views = [], canSave = false, exportDataset = null }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const exportQuery = new URLSearchParams(query);
  exportQuery.delete('page');
  exportQuery.delete('size');
  const exportHref = exportDataset ? `/admin/export/${exportDataset}${exportQuery.toString() ? `?${exportQuery}` : ''}` : null;

  function run(action, onOk) {
    startTransition(async () => {
      let result;
      try {
        result = await action();
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error });
      if (result?.ok) {
        onOk?.();
        router.refresh();
      }
    });
  }

  return (
    <div className="flex h-9 items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={BUTTON} disabled={pending}>
            <Bookmark strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('admin.views.title')}
            {views.length ? <span className="u-tabular text-ink-45">{views.length}</span> : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>{t('admin.views.title')}</DropdownMenuLabel>
          {views.length === 0 ? <div className="u-micro px-2 py-1.5 text-ink-45">{t('admin.views.none')}</div> : null}
          {views.map((view) => (
            <div key={view.id} className="flex items-center gap-1">
              <DropdownMenuItem className="flex-1" onSelect={() => router.push(`${path}${view.query ? `?${view.query}` : ''}`)}>
                {view.name}
              </DropdownMenuItem>
              {canSave ? (
                <button
                  type="button"
                  className="rounded p-1.5 text-ink-35 hover:bg-danger-tint hover:text-danger"
                  aria-label={t('admin.views.delete', { name: view.name })}
                  onClick={() => run(() => deleteViewAction(view.id))}
                >
                  <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ))}
          <DropdownMenuSeparator />
          {canSave ? (
            <DropdownMenuItem onSelect={() => setNaming(true)}>{t('admin.views.saveCurrent')}</DropdownMenuItem>
          ) : (
            <div className="u-micro px-2 py-1.5 text-ink-45">{t('admin.views.needAccount')}</div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {exportHref ? (
        <a href={exportHref} className={BUTTON}>
          <Download strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.views.export')}
        </a>
      ) : null}

      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('admin.views.saveTitle')}</DialogTitle>
          </DialogHeader>
          <input
            autoFocus
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('admin.views.namePlaceholder')}
            className="u-focus-ring u-micro h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-ink"
          />
          <DialogFooter>
            <button type="button" className={BUTTON} onClick={() => setNaming(false)}>{t('common.actions.cancel')}</button>
            <button
              type="button"
              disabled={pending || !name.trim()}
              className="u-press u-btn-primary inline-flex h-9 items-center rounded-lg bg-blue px-4 text-sm font-semibold text-white hover:bg-blue-deep disabled:opacity-50"
              onClick={() => run(() => saveViewAction(path, name, query), () => {
                setNaming(false);
                setName('');
              })}
            >
              {t('common.actions.save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
