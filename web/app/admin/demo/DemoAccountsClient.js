'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Briefcase, FlaskConical, MessageSquareText, RotateCcw, Trash2, User } from 'lucide-react';
import PhoneField from '@/components/PhoneField';
import { useToast } from '@/components/Toast';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import {
  createDemoAccountAction, deleteDemoAccountAction, openDemoSideAction, resetDemoAccountAction, updateDemoDeliverToAction,
} from './actions';

const FIELD = 'u-focus-ring h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink';
const LABEL = 'u-eyebrow mb-1.5 block text-ink-45';
const BUTTON = 'u-press u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-ink transition-colors hover:border-blue disabled:opacity-50';
const PRIMARY = 'u-btn-primary u-press inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue px-3 text-[0.8125rem] font-bold text-white disabled:opacity-60';

function formatPhone(digits) {
  const d = String(digits || '');
  return d.length === 12 ? `+${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}` : `+${d}`;
}

export function CreateDemoForm() {
  const t = useT();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [formKey, setFormKey] = useState(0);

  function submit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = await createDemoAccountAction(formData);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      if (!result?.ok) {
        setError(result?.error || t('errors.actionFailed'));
        return;
      }
      setFormKey((k) => k + 1);
      showToast({ type: 'success', message: t('admin.demo.created') });
    });
  }

  return (
    <form key={formKey} onSubmit={submit} className="u-card flex flex-col gap-4 rounded-card bg-surface p-5">
      <h2 className="u-title-card text-ink">{t('admin.demo.createTitle')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className={LABEL}>{t('admin.demo.label')}</span>
          <input name="label" required maxLength={80} placeholder={t('admin.demo.labelPlaceholder')} className={FIELD} />
        </label>
        <label>
          <span className={LABEL}>{t('admin.demo.customerName')}</span>
          <input name="customer_name" maxLength={120} placeholder="Client démo" className={FIELD} />
        </label>
        <label>
          <span className={LABEL}>{t('admin.demo.agentName')}</span>
          <input name="agent_name" maxLength={80} placeholder="Agent démo" className={FIELD} />
        </label>
        <label>
          <span className={LABEL}>{t('admin.demo.agencyName')}</span>
          <input name="agency_name" maxLength={160} placeholder={t('admin.demo.agencyPlaceholder')} className={FIELD} />
        </label>
        <PhoneField
          name="deliver_to"
          autoComplete="off"
          labels={{ label: t('admin.demo.deliverTo') }}
          hint={t('admin.demo.deliverToHint')}
        />
      </div>
      {error ? <p role="alert" className="u-micro rounded-lg bg-danger-tint px-3.5 py-2.5 text-danger">{error}</p> : null}
      <div>
        <button type="submit" disabled={pending} className={PRIMARY}>
          <FlaskConical strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {pending ? t('admin.demo.creating') : t('admin.demo.create')}
        </button>
      </div>
    </form>
  );
}

export function DemoPairCard({ pair }) {
  const t = useT();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [editingCopies, setEditingCopies] = useState(false);

  function run(action, { confirmKey, successKey, navigate } = {}) {
    if (confirmKey && !window.confirm(t(confirmKey, { label: pair.label }))) return;
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
      if (navigate && result.redirectTo) {
        // A full navigation: the new session cookies must be read fresh.
        window.location.assign(result.redirectTo);
        return;
      }
      if (result.engineError) showToast({ type: 'error', message: t('admin.demo.engineLeft', { error: result.engineError }) });
      else if (successKey) showToast({ type: 'success', message: t(successKey) });
    });
  }

  function saveCopies(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      let result;
      try {
        result = await updateDemoDeliverToAction(pair.id, formData);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      if (!result?.ok) {
        showToast({ type: 'error', message: result?.error || t('errors.actionFailed') });
        return;
      }
      setEditingCopies(false);
      showToast({ type: 'success', message: t('admin.demo.copiesSaved') });
    });
  }

  return (
    <article className="u-card flex flex-col gap-4 rounded-card bg-surface p-5" data-demo-pair={pair.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="u-title-card text-ink">{pair.label}</h3>
          <p className="u-micro text-ink-45">
            {t('admin.demo.createdBy', { who: pair.createdBy || '—' })}
            {pair.resetAt ? ` · ${t('admin.demo.resetOn', { date: new Date(pair.resetAt).toLocaleDateString('fr-FR') })}` : ''}
          </p>
        </div>
        <Link href={`/admin/demo/${pair.id}`} className={BUTTON}>
          <MessageSquareText strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.demo.messages')}
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-line p-3">
          <p className="u-eyebrow text-ink-45">{t('admin.demo.customerSide')}</p>
          <p className="u-micro-strong mt-1 text-ink">{pair.customerName || 'Client démo'} · #{pair.customerId ?? '—'}</p>
          <p className="u-micro u-tabular text-ink-45">{formatPhone(pair.customerPhone)}</p>
          <p className="u-micro text-ink-45">{t('admin.demo.favorites', { count: pair.favorites ?? 0 })}</p>
          <button
            type="button"
            disabled={pending || !pair.customerId}
            onClick={() => run(() => openDemoSideAction(pair.id, 'customer'), { navigate: true })}
            className={`${PRIMARY} mt-3`}
          >
            <User strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('admin.demo.openCustomer')}
          </button>
        </div>
        <div className="rounded-lg border border-line p-3">
          <p className="u-eyebrow text-ink-45">{t('admin.demo.agentSide')}</p>
          <p className="u-micro-strong mt-1 text-ink">{pair.agentName || 'Agent démo'} · #{pair.agentId ?? '—'}</p>
          <p className="u-micro u-tabular text-ink-45">{formatPhone(pair.agentPhone)}</p>
          <p className="u-micro text-ink-45">{t('admin.demo.listings', { count: pair.listings ?? 0 })}</p>
          <button
            type="button"
            disabled={pending || !pair.agentId}
            onClick={() => run(() => openDemoSideAction(pair.id, 'agent'), { navigate: true })}
            className={`${PRIMARY} mt-3`}
          >
            <Briefcase strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('admin.demo.openAgent')}
          </button>
        </div>
      </div>

      <div className="u-micro rounded-lg bg-canvas-alt px-3 py-2.5 text-ink-70">
        {editingCopies ? (
          <form onSubmit={saveCopies} className="flex flex-col gap-3">
            <PhoneField
              name="deliver_to"
              autoComplete="off"
              defaultValue={pair.deliverTo ? `+${pair.deliverTo}` : ''}
              labels={{ label: t('admin.demo.deliverTo') }}
              hint={t('admin.demo.deliverToClear')}
            />
            <div className="flex gap-2">
              <button type="submit" disabled={pending} className={PRIMARY}>{t('common.actions.save')}</button>
              <button type="button" onClick={() => setEditingCopies(false)} className={BUTTON}>{t('common.actions.cancel')}</button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {pair.deliverTo
                ? t('admin.demo.copiesTo', { phone: formatPhone(pair.deliverTo) })
                : t('admin.demo.copiesNone')}
            </span>
            <button type="button" onClick={() => setEditingCopies(true)} className="u-micro-strong text-blue-deep hover:underline">
              {t('admin.demo.copiesEdit')}
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => resetDemoAccountAction(pair.id), { confirmKey: 'admin.demo.confirmReset', successKey: 'admin.demo.resetDone' })}
          className={BUTTON}
        >
          <RotateCcw strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.demo.reset')}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => deleteDemoAccountAction(pair.id), { confirmKey: 'admin.demo.confirmDelete', successKey: 'admin.demo.deleted' })}
          className={`${BUTTON} text-danger hover:border-danger`}
        >
          <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.demo.delete')}
        </button>
      </div>
    </article>
  );
}
