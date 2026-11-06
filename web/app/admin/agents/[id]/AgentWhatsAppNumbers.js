'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MessageCircle, Plus, X } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { formatPhoneDisplay } from '@/lib/phone';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n/client';
import PhoneField from '@/components/PhoneField';
import { addAgentWhatsAppNumberAction, removeAgentWhatsAppNumberAction } from './whatsappNumberActions';

const BUTTON = 'u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-ink hover:border-blue disabled:opacity-50';

/**
 * "Numéros WhatsApp" on an agent's console page: the other numbers this agent
 * WhatsApps listings from. A listing sent from one is attributed to the agent
 * like one sent from their own phone. Never shown publicly — the account's
 * own number stays the one on listings and the one alerts go to.
 *
 * `numbers` is null when the engine could not be asked; `available` false
 * before the migration has run.
 */
export default function AgentWhatsAppNumbers({ agentId, numbers, available, canManage }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  if (numbers == null) return null;
  if (!available) {
    return canManage ? <p className="u-micro mt-1.5 text-ink-45">{t('admin.agentNumbers.unavailable')}</p> : null;
  }
  if (!numbers.length && !canManage) return null;

  function add(formData) {
    startTransition(async () => {
      let response;
      try {
        response = await addAgentWhatsAppNumberAction(agentId, formData);
      } catch (err) {
        response = { ok: false, error: err.message };
      }
      if (!response?.ok) {
        showToast({ type: 'error', message: response?.error || t('errors.actionFailed') });
        return;
      }
      showToast({
        type: 'success',
        message: response.claimError
          ? t('admin.agentNumbers.addedClaimFailed', { phone: formatPhoneDisplay(response.phone) })
          : t('admin.agentNumbers.added', { phone: formatPhoneDisplay(response.phone), count: response.claimed }),
      });
      setAdding(false);
      router.refresh();
    });
  }

  function remove(phone) {
    if (!window.confirm(t('admin.agentNumbers.removeConfirm', { phone: formatPhoneDisplay(phone) }))) return;
    startTransition(async () => {
      let response;
      try {
        response = await removeAgentWhatsAppNumberAction(agentId, phone);
      } catch (err) {
        response = { ok: false, error: err.message };
      }
      if (!response?.ok) {
        showToast({ type: 'error', message: response?.error || t('errors.actionFailed') });
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="u-micro flex flex-wrap items-center gap-2 text-ink-45">
        <span className="inline-flex items-center gap-1.5">
          <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
          {t('admin.agentNumbers.label')}
        </span>
        {numbers.length ? numbers.map((n) => (
          <span key={n.phone} className="u-tabular inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-ink-70">
            {formatPhoneDisplay(n.phone)}
            {canManage ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(n.phone)}
                aria-label={t('admin.agentNumbers.remove', { phone: formatPhoneDisplay(n.phone) })}
                className="rounded p-0.5 text-ink-45 hover:text-danger disabled:opacity-50"
              >
                <X strokeWidth={ICON_STROKE_WIDTH} className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        )) : <span>{t('admin.agentNumbers.none')}</span>}
        {canManage && !adding ? (
          <button type="button" className={BUTTON} disabled={pending} onClick={() => setAdding(true)}>
            <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
            {t('admin.agentNumbers.add')}
          </button>
        ) : null}
      </div>

      {canManage && adding ? (
        <form action={add} className="flex max-w-xl flex-col gap-2 rounded-lg border border-line bg-canvas-alt p-3">
          <p className="u-micro text-ink-70">{t('admin.agentNumbers.warning')}</p>
          <PhoneField
            name="phone"
            required
            autoFocus
            autoComplete="off"
            labels={{ label: t('admin.agentNumbers.phoneLabel') }}
            hint={t('admin.agentCreate.phoneHint')}
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={`${BUTTON} border-blue bg-blue text-white hover:bg-blue-deep`}>
              {pending ? t('admin.agentNumbers.adding') : t('admin.agentNumbers.submit')}
            </button>
            <button type="button" disabled={pending} className={BUTTON} onClick={() => setAdding(false)}>
              {t('admin.agentNumbers.cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
