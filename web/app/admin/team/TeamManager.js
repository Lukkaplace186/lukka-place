'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Copy, KeyRound, Trash2, UserPlus } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { ADMIN_ROLES, ROLE_LABEL_KEYS, normalizeRoleKeys } from '@/lib/adminRoles';
import { useT } from '@/lib/i18n/client';
import { Chip } from '../LeadRoutingUI';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../table/TableFrame';
import {
  deleteAdminUserAction, inviteAdminAction, reissueAdminAccessAction, setAdminStatusAction, updateAdminRolesAction,
} from './actions';

const CONTROL = 'u-focus-ring u-micro h-9 rounded-lg border border-line bg-surface px-2.5 text-ink';
const BUTTON = 'u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-ink hover:border-blue disabled:opacity-50';

const STATUS_TONE = { active: 'success', invited: 'blue', disabled: 'neutral' };

/** The label of one role key: built-in from i18n, custom by its saved name. */
function useRoleLabel(customRoles) {
  const t = useT();
  const names = Object.fromEntries(customRoles.map((role) => [role.key, role.name]));
  return (key) => (ROLE_LABEL_KEYS[key] ? t(ROLE_LABEL_KEYS[key]) : names[key] || t('admin.team.custom.deleted'));
}

/**
 * Tick one or several roles; their permissions add up. Propriétaire already
 * includes everything, so ticking it clears the others (and the reverse).
 */
function RoleChecklist({ value, onChange, customRoles, disabled = false }) {
  const t = useT();
  const label = useRoleLabel(customRoles);
  const toggle = (key) => {
    if (value.includes(key)) {
      onChange(value.filter((k) => k !== key));
    } else {
      onChange(normalizeRoleKeys(key === 'owner' ? ['owner'] : [...value.filter((k) => k !== 'owner'), key]));
    }
  };
  const row = (key, help) => (
    <label key={key} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-canvas-deep">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-blue" checked={value.includes(key)} disabled={disabled} onChange={() => toggle(key)} />
      <span className="min-w-0">
        <span className="u-micro-strong block text-ink">{label(key)}</span>
        {help ? <span className="u-micro block text-ink-45">{help}</span> : null}
      </span>
    </label>
  );
  return (
    <div className="flex flex-col gap-0.5">
      <p className="u-eyebrow px-2 pb-1 text-ink-45">{t('admin.team.builtInRoles')}</p>
      {ADMIN_ROLES.map((key) => row(key, t(`admin.team.roleHelp.${key}`)))}
      <p className="u-eyebrow px-2 pb-1 pt-2 text-ink-45">{t('admin.team.custom.title')}</p>
      {customRoles.length
        ? customRoles.map((role) => row(role.key, role.description || t('admin.team.custom.permissionCount', { count: role.permissions.length })))
        : <p className="u-micro px-2 text-ink-45">{t('admin.team.custom.noneYet')}</p>}
    </div>
  );
}

/** A trigger showing the current roles, opening the checklist. */
function RolePopover({ value, customRoles, disabled, onSave, saveLabel, onChange, ariaLabel }) {
  const t = useT();
  const label = useRoleLabel(customRoles);
  const [open, setOpen] = useState(false);
  // In "save" mode the person edits a draft and confirms; otherwise each tick applies at once.
  const [draft, setDraft] = useState(value);
  const shown = onSave ? draft : value;
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setDraft(value); }}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} aria-label={ariaLabel} className={`${CONTROL} inline-flex min-w-[10rem] max-w-[16rem] items-center justify-between gap-2 text-left disabled:opacity-60`}>
          <span className="truncate">{value.length ? value.map(label).join(' + ') : t('admin.team.pickRoles')}</span>
          <ChevronDown strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 shrink-0 text-ink-45" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[70vh] w-80 overflow-y-auto p-2">
        <RoleChecklist value={shown} customRoles={customRoles} onChange={onSave ? setDraft : onChange} />
        <p className="u-micro px-2 pt-2 text-ink-45">{t('admin.team.combineHint')}</p>
        {onSave ? (
          <div className="flex justify-end gap-1.5 px-2 pt-2">
            <button type="button" className={BUTTON} onClick={() => setOpen(false)}>{t('admin.team.cancel')}</button>
            <button
              type="button"
              className="u-press u-micro-strong inline-flex h-8 items-center rounded-md bg-blue px-3 text-white hover:bg-blue-deep disabled:opacity-50"
              disabled={!draft.length}
              onClick={() => { setOpen(false); onSave(draft); }}
            >
              {saveLabel}
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export default function TeamManager({ users, currentAdminId, customRoles = [] }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ fullName: '', email: '', roles: ['moderator'] });
  const [link, setLink] = useState(null);
  // The account awaiting a confirmed permanent deletion.
  const [toDelete, setToDelete] = useState(null);

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

  return (
    <div className="flex flex-col gap-5">
      <form
        className="u-card flex flex-wrap items-end gap-2 rounded-card bg-surface p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.roles.length) {
            showToast({ type: 'error', message: t('admin.team.invalidRole') });
            return;
          }
          run(() => inviteAdminAction(form), (result) => {
            setLink({ url: result.link, name: result.name });
            setForm({ fullName: '', email: '', roles: form.roles });
          });
        }}
      >
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <span className="u-eyebrow text-ink-45">{t('admin.team.fullName')}</span>
          <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className={CONTROL} />
        </label>
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
          <span className="u-eyebrow text-ink-45">{t('admin.team.email')}</span>
          <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={CONTROL} />
        </label>
        <div className="flex flex-col gap-1">
          <span className="u-eyebrow text-ink-45">{t('admin.team.rolesLabel')}</span>
          <RolePopover
            value={form.roles}
            customRoles={customRoles}
            onChange={(roles) => setForm({ ...form, roles })}
            ariaLabel={t('admin.team.rolesLabel')}
          />
        </div>
        <button type="submit" disabled={pending} className="u-press u-btn-primary inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue px-4 text-sm font-semibold text-white hover:bg-blue-deep disabled:opacity-50">
          <UserPlus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.team.invite')}
        </button>
      </form>

      <TableFrame minWidth="56rem">
        <thead>
          <tr>
            <th className={TH_STICKY}>{t('admin.team.colPerson')}</th>
            <th className={TH_STICKY}>{t('admin.team.rolesLabel')}</th>
            <th className={TH_STICKY}>{t('admin.team.colStatus')}</th>
            <th className={TH_STICKY}>{t('admin.team.colLastLogin')}</th>
            <th className={TH_STICKY}>{t('admin.team.colInvitedBy')}</th>
            <th className={TH_STICKY} aria-label={t('admin.table.moreActions')} />
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <EmptyRow colSpan={6}>{t('admin.team.empty')}</EmptyRow>
          ) : (
            users.map((user) => (
              <tr key={user.id} className={TR_DENSE}>
                <td className={TD_DENSE}>
                  <div className="font-semibold text-ink">
                    {user.full_name}
                    {user.id === currentAdminId ? <span className="ml-1.5 text-ink-45">({t('admin.team.you')})</span> : null}
                  </div>
                  <div className="text-ink-45">{user.email}</div>
                </td>
                <td className={TD_DENSE}>
                  <RolePopover
                    value={user.roles}
                    customRoles={customRoles}
                    disabled={pending || user.status === 'disabled'}
                    saveLabel={t('admin.team.saveRoles')}
                    onSave={(roles) => run(() => updateAdminRolesAction(user.id, roles))}
                    ariaLabel={t('admin.team.rolesFor', { name: user.full_name })}
                  />
                </td>
                <td className={TD_DENSE}>
                  <Chip tone={STATUS_TONE[user.status]}>{t(`admin.team.status.${user.status}`)}</Chip>
                  {user.invite_pending ? (
                    <div className="mt-1 text-ink-45">
                      {t('admin.team.linkValidUntil', { date: new Date(user.activation_expires_at).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' }) })}
                    </div>
                  ) : null}
                  {user.locked_until && new Date(user.locked_until) > new Date() ? <div className="mt-1"><Chip tone="danger">{t('admin.team.locked')}</Chip></div> : null}
                </td>
                <td className={`${TD_DENSE} whitespace-nowrap`}>
                  {user.last_login_at ? new Date(user.last_login_at).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' }) : '—'}
                </td>
                <td className={TD_DENSE}>{user.invited_by_name || '—'}</td>
                <td className={TD_DENSE}>
                  <div className="flex flex-wrap gap-1.5">
                    {user.status !== 'disabled' ? (
                      <button type="button" className={BUTTON} disabled={pending} onClick={() => run(() => reissueAdminAccessAction(user.id), (result) => setLink({ url: result.link, name: user.full_name }))}>
                        <KeyRound strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                        {user.status === 'invited' ? t('admin.team.newInviteLink') : t('admin.team.resetAccess')}
                      </button>
                    ) : null}
                    {user.status === 'disabled' ? (
                      <button type="button" className={BUTTON} disabled={pending} onClick={() => run(() => setAdminStatusAction(user.id, 'active'))}>
                        {t('admin.team.enable')}
                      </button>
                    ) : null}
                    {/* Only an account nobody uses any more: disabled, or an invitation never accepted. */}
                    {(user.status === 'disabled' || user.status === 'invited') && user.id !== currentAdminId ? (
                      <button type="button" className={`${BUTTON} text-danger`} disabled={pending} onClick={() => setToDelete(user)}>
                        <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                        {user.status === 'invited' ? t('admin.team.deleteInvite') : t('admin.team.delete')}
                      </button>
                    ) : null}
                    {user.status === 'disabled' ? null : (
                      <button type="button" className={`${BUTTON} text-danger`} disabled={pending} onClick={() => run(() => setAdminStatusAction(user.id, 'disabled'))}>
                        {t('admin.team.disable')}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </TableFrame>

      <Dialog open={Boolean(toDelete)} onOpenChange={(open) => { if (!open) setToDelete(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('admin.team.deleteTitle', { name: toDelete?.full_name || '' })}</DialogTitle>
            <DialogDescription>{t('admin.team.deleteBody', { email: toDelete?.email || '' })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className={BUTTON} onClick={() => setToDelete(null)}>{t('admin.team.cancel')}</button>
            <button
              type="button"
              disabled={pending}
              className={`${BUTTON} border-danger/40 text-danger`}
              onClick={() => run(() => deleteAdminUserAction(toDelete.id), () => setToDelete(null))}
            >
              <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
              {t('admin.team.deleteConfirm')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(link)} onOpenChange={(open) => { if (!open) setLink(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('admin.team.linkTitle')}</DialogTitle>
            <DialogDescription>{t('admin.team.linkBody', { name: link?.name || '' })}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <input readOnly value={link?.url || ''} className={`${CONTROL} min-w-0 flex-1 font-mono text-[0.75rem]`} onFocus={(e) => e.target.select()} />
            <button
              type="button"
              className={BUTTON}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link.url);
                  showToast({ type: 'success', message: t('admin.team.copied') });
                } catch {
                  showToast({ type: 'error', message: t('admin.team.copyFailed') });
                }
              }}
            >
              <Copy strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
              {t('admin.team.copy')}
            </button>
          </div>
          <p className="u-micro text-ink-45">{t('admin.team.linkWarning')}</p>
          <DialogFooter>
            <button type="button" className={BUTTON} onClick={() => setLink(null)}>{t('admin.team.done')}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
