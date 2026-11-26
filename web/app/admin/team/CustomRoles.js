'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { PERMISSION_GROUPS, permissionLabelKey } from '@/lib/adminRoles';
import { useT } from '@/lib/i18n/client';
import { createCustomRoleAction, deleteCustomRoleAction, updateCustomRoleAction } from './actions';

const CONTROL = 'u-focus-ring u-micro h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-ink';
const BUTTON = 'u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-ink hover:border-blue disabled:opacity-50';

// What a new custom role starts with: the read-only views every built-in role has.
const STARTER_PERMISSIONS = ['analytics.view', 'listings.view', 'agents.view'];

/**
 * Custom roles on /admin/team: a name and a set of permissions, ticked from
 * the same list the built-in roles are made of. Managing the team is not in
 * the list (it stays with Propriétaire). Changes apply on each holder's next
 * page; a role still held by someone cannot be deleted.
 */
export default function CustomRoles({ customRoles }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  // null = closed; { id: null } = creating; { id, ... } = editing
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  function run(action, onOk) {
    startTransition(async () => {
      let result;
      try {
        result = await action();
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      if (!result?.ok) {
        showToast({ type: 'error', message: result?.error || t('errors.actionFailed') });
        return;
      }
      showToast({ type: 'success', message: result.message });
      onOk?.(result);
      router.refresh();
    });
  }

  const togglePermission = (permission) => setEditing((current) => ({
    ...current,
    permissions: current.permissions.includes(permission)
      ? current.permissions.filter((p) => p !== permission)
      : [...current.permissions, permission],
  }));

  const toggleGroup = (group, on) => setEditing((current) => ({
    ...current,
    permissions: on
      ? [...new Set([...current.permissions, ...group.permissions])]
      : current.permissions.filter((p) => !group.permissions.includes(p)),
  }));

  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="u-micro-strong text-ink">{t('admin.team.custom.title')}</h3>
          <p className="u-micro text-ink-45">{t('admin.team.custom.subtitle')}</p>
        </div>
        <button
          type="button"
          className={BUTTON}
          disabled={pending}
          onClick={() => setEditing({ id: null, name: '', description: '', permissions: STARTER_PERMISSIONS })}
        >
          <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
          {t('admin.team.custom.create')}
        </button>
      </div>

      {customRoles.length === 0 ? (
        <p className="u-micro mt-3 text-ink-45">{t('admin.team.custom.noneYet')}</p>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {customRoles.map((role) => (
            <li key={role.id} className="rounded-lg border border-line p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="u-micro-strong text-ink">{role.name}</p>
                  {role.description ? <p className="u-micro text-ink-70">{role.description}</p> : null}
                  <p className="u-micro mt-1 text-ink-45">
                    {t('admin.team.custom.permissionCount', { count: role.permissions.length })}
                    {' · '}
                    {t('admin.team.custom.holders', { count: role.holders })}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className={BUTTON}
                    disabled={pending}
                    aria-label={t('admin.team.custom.editNamed', { name: role.name })}
                    onClick={() => setEditing({ id: role.id, name: role.name, description: role.description, permissions: role.permissions })}
                  >
                    <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className={`${BUTTON} text-danger`}
                    disabled={pending}
                    aria-label={t('admin.team.custom.deleteNamed', { name: role.name })}
                    onClick={() => setConfirmDelete(role)}
                  >
                    <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <ul className="mt-2 flex flex-wrap gap-1">
                {role.permissions.map((permission) => (
                  <li key={permission} className="rounded-full bg-canvas-deep px-2 py-0.5 text-[0.6875rem] text-ink-70">{t(permissionLabelKey(permission))}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? t('admin.team.custom.editTitle') : t('admin.team.custom.createTitle')}</DialogTitle>
            <DialogDescription>{t('admin.team.custom.dialogBody')}</DialogDescription>
          </DialogHeader>
          {editing ? (
            <form
              id="custom-role-form"
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                const values = { name: editing.name, description: editing.description, permissions: editing.permissions };
                run(
                  () => (editing.id ? updateCustomRoleAction(editing.id, values) : createCustomRoleAction(values)),
                  () => setEditing(null),
                );
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="u-eyebrow text-ink-45">{t('admin.team.custom.name')}</span>
                  <input
                    required
                    maxLength={60}
                    value={editing.name}
                    placeholder={t('admin.team.custom.namePlaceholder')}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className={CONTROL}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="u-eyebrow text-ink-45">{t('admin.team.custom.description')}</span>
                  <input
                    maxLength={200}
                    value={editing.description}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    className={CONTROL}
                  />
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {PERMISSION_GROUPS.map((group) => {
                  const allOn = group.permissions.every((p) => editing.permissions.includes(p));
                  return (
                    <fieldset key={group.key} className="rounded-lg border border-line p-3">
                      <legend className="flex w-full items-center justify-between gap-2 px-1">
                        <span className="u-micro-strong text-ink">{t(`admin.team.permGroups.${group.key}`)}</span>
                        <button type="button" className="u-micro text-blue-deep hover:underline" onClick={() => toggleGroup(group, !allOn)}>
                          {allOn ? t('admin.team.custom.noneInGroup') : t('admin.team.custom.allInGroup')}
                        </button>
                      </legend>
                      <div className="mt-1 flex flex-col gap-1">
                        {group.permissions.map((permission) => (
                          <label key={permission} className="flex cursor-pointer items-start gap-2">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 accent-blue"
                              checked={editing.permissions.includes(permission)}
                              onChange={() => togglePermission(permission)}
                            />
                            <span className="u-micro text-ink-70">{t(permissionLabelKey(permission))}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  );
                })}
              </div>
              <p className="u-micro text-ink-45">{t('admin.team.custom.teamNote')}</p>
            </form>
          ) : null}
          <DialogFooter>
            <button type="button" className={BUTTON} onClick={() => setEditing(null)}>{t('admin.team.cancel')}</button>
            <button
              type="submit"
              form="custom-role-form"
              disabled={pending || !editing?.permissions?.length || !editing?.name?.trim()}
              className="u-press u-btn-primary inline-flex h-8 items-center rounded-md bg-blue px-3 text-sm font-semibold text-white hover:bg-blue-deep disabled:opacity-50"
            >
              {editing?.id ? t('admin.team.custom.save') : t('admin.team.custom.create')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmDelete)} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('admin.team.custom.deleteTitle', { name: confirmDelete?.name || '' })}</DialogTitle>
            <DialogDescription>
              {confirmDelete?.holders
                ? t('admin.team.custom.stillAssigned', { count: confirmDelete.holders })
                : t('admin.team.custom.deleteBody')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className={BUTTON} onClick={() => setConfirmDelete(null)}>{t('admin.team.cancel')}</button>
            <button
              type="button"
              disabled={pending || Boolean(confirmDelete?.holders)}
              className={`${BUTTON} border-danger/40 text-danger`}
              onClick={() => run(() => deleteCustomRoleAction(confirmDelete.id), () => setConfirmDelete(null))}
            >
              <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
              {t('admin.team.custom.delete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
