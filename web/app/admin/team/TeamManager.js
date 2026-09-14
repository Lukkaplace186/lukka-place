'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, KeyRound, UserPlus } from 'lucide-react';
import { useToast } from '@/components/Toast';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { ADMIN_ROLES, ROLE_LABEL_KEYS } from '@/lib/adminRoles';
import { useT } from '@/lib/i18n/client';
import { Chip } from '../LeadRoutingUI';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../table/TableFrame';
import { inviteAdminAction, reissueAdminAccessAction, setAdminStatusAction, updateAdminRoleAction } from './actions';

const CONTROL = 'u-focus-ring u-micro h-9 rounded-lg border border-line bg-surface px-2.5 text-ink';
const BUTTON = 'u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-ink hover:border-blue disabled:opacity-50';

const STATUS_TONE = { active: 'success', invited: 'blue', disabled: 'neutral' };

export default function TeamManager({ users, currentAdminId }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ fullName: '', email: '', role: 'moderator' });
  const [link, setLink] = useState(null);

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
          run(() => inviteAdminAction(form), (result) => {
            setLink({ url: result.link, name: result.name });
            setForm({ fullName: '', email: '', role: form.role });
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
        <label className="flex flex-col gap-1">
          <span className="u-eyebrow text-ink-45">{t('admin.team.roleLabel')}</span>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={CONTROL}>
            {ADMIN_ROLES.map((role) => <option key={role} value={role}>{t(ROLE_LABEL_KEYS[role])}</option>)}
          </select>
        </label>
        <button type="submit" disabled={pending} className="u-press u-btn-primary inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue px-4 text-sm font-semibold text-white hover:bg-blue-deep disabled:opacity-50">
          <UserPlus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.team.invite')}
        </button>
      </form>

      <TableFrame minWidth="56rem">
        <thead>
          <tr>
            <th className={TH_STICKY}>{t('admin.team.colPerson')}</th>
            <th className={TH_STICKY}>{t('admin.team.roleLabel')}</th>
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
                  <select
                    value={user.role}
                    disabled={pending || user.status === 'disabled'}
                    onChange={(event) => run(() => updateAdminRoleAction(user.id, event.target.value))}
                    className={CONTROL}
                    aria-label={t('admin.team.roleLabel')}
                  >
                    {ADMIN_ROLES.map((role) => <option key={role} value={role}>{t(ROLE_LABEL_KEYS[role])}</option>)}
                  </select>
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
                    ) : (
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
