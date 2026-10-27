'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { UserPlus } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { communeLabel } from '@/lib/cities';
import PhoneField from '@/components/PhoneField';
import ActivationLinkPanel from '../ActivationLinkPanel';
import { adminCreateAgentAction } from '../createAgentActions';

const FIELD = 'u-focus-ring h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink';
const LABEL = 'u-eyebrow mb-1.5 block text-ink-45';

/**
 * The console's "Créer un agent" form. adminCreateAgentAction re-validates
 * everything (phone shape, business numbers, the commune list); the engine
 * refuses a number that already has an account.
 */
export default function AdminCreateAgentForm({ communes }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [existingId, setExistingId] = useState(null);
  const [result, setResult] = useState(null);
  const [formKey, setFormKey] = useState(0);

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setExistingId(null);
    startTransition(async () => {
      let response;
      try {
        response = await adminCreateAgentAction(formData);
      } catch (err) {
        response = { ok: false, error: err.message };
      }
      if (!response?.ok) {
        setError(response?.error || t('errors.actionFailed'));
        setExistingId(response?.existingAgentId ?? null);
        return;
      }
      setResult(response);
    });
  }

  if (result) {
    return (
      <div className="u-card flex flex-col gap-4 rounded-card bg-surface p-6">
        <ActivationLinkPanel result={result} />
        <button
          type="button"
          onClick={() => { setResult(null); setFormKey((k) => k + 1); }}
          className="u-micro-strong self-start text-blue-deep hover:underline"
        >
          {t('admin.agentCreate.another')}
        </button>
      </div>
    );
  }

  return (
    <form key={formKey} onSubmit={handleSubmit} className="u-card flex flex-col gap-5 rounded-card bg-surface p-6">
      <p className="u-micro rounded-lg bg-warning-tint px-3.5 py-3 text-ink-70">{t('admin.agentCreate.warning')}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={LABEL}>{t('admin.agentCreate.firstName')}</span>
          <input name="first_name" required maxLength={80} className={FIELD} />
        </label>
        <label>
          <span className={LABEL}>{t('admin.agentCreate.lastName')}</span>
          <input name="last_name" maxLength={80} className={FIELD} />
        </label>
        <label>
          <span className={LABEL}>{t('admin.agentCreate.agency')}</span>
          <input name="agency_name" maxLength={160} className={FIELD} />
        </label>
        <PhoneField
          name="phone"
          required
          autoComplete="off"
          labels={{ label: t('admin.agentCreate.phone') }}
          hint={t('admin.agentCreate.phoneHint')}
        />
      </div>

      {communes.length ? (
        <div>
          <span className={LABEL}>{t('admin.agentPanel.primaryCommunes')}</span>
          <div className="grid max-h-56 grid-cols-2 gap-x-3 gap-y-1.5 overflow-y-auto rounded-lg border border-line bg-canvas-alt p-3 sm:grid-cols-3">
            {communes.map((commune) => (
              <label key={commune} className="u-micro flex items-center gap-2 text-ink-70">
                <input type="checkbox" name="primary_communes" value={commune} className="h-3.5 w-3.5 rounded-sm accent-[var(--blue)]" />
                <span className="truncate">{communeLabel(commune)}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="u-micro rounded-lg bg-danger-tint px-3.5 py-2.5 text-danger">
          {error}
          {existingId ? (
            <>
              {' '}
              <Link href={`/admin/agents/${existingId}`} className="font-bold underline">
                {t('admin.agentCreate.openAgent', { id: existingId })}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="u-btn-primary u-press inline-flex h-10 items-center gap-2 rounded-lg bg-blue px-4 text-[0.8125rem] font-bold text-white disabled:opacity-60"
        >
          <UserPlus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {pending ? t('admin.agentCreate.creating') : t('admin.agentCreate.submit')}
        </button>
      </div>
    </form>
  );
}
