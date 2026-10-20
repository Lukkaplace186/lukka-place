'use client';

import { useTransition } from 'react';
import { BellRing } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n/client';
import { sendVerificationReminderAction } from '../verificationReminderActions';

/** "Rappeler de vérifier" on the agent's page. */
export default function VerificationReminderButton({ agentId }) {
  const t = useT();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      title={t('admin.agents.reminderHint')}
      onClick={() => startTransition(async () => {
        let result;
        try {
          result = await sendVerificationReminderAction(agentId);
        } catch (err) {
          result = { ok: false, error: err.message };
        }
        showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error || t('errors.actionFailed') });
      })}
      className="u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-ink hover:border-blue disabled:opacity-50"
    >
      <BellRing strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
      {t('admin.agents.remindVerify')}
    </button>
  );
}
