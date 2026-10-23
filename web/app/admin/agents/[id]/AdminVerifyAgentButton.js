'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n/client';
import ActivationLinkPanel from '../ActivationLinkPanel';
import { adminVerifyAgentAction } from '../createAgentActions';

/**
 * "Vérifier le numéro" on an unverified agent's page: the team vouches for
 * the number with no code from the phone, and the number's listings are
 * claimed. Asks first — it publishes the number on every listing it holds.
 */
export default function AdminVerifyAgentButton({ agentId, phone }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState(null);

  function verify() {
    if (!window.confirm(t('admin.agentCreate.verifyConfirm', { phone: phone ? `+${phone}` : '' }))) return;
    startTransition(async () => {
      let response;
      try {
        response = await adminVerifyAgentAction(agentId);
      } catch (err) {
        response = { ok: false, error: err.message };
      }
      if (!response?.ok) {
        showToast({ type: 'error', message: response?.error || t('errors.actionFailed') });
        return;
      }
      setResult(response);
      router.refresh();
    });
  }

  if (result) {
    return (
      <div className="basis-full">
        <ActivationLinkPanel result={result} showAgentLink={false} />
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      title={t('admin.agentCreate.verifyHint')}
      onClick={verify}
      className="u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-ink hover:border-blue disabled:opacity-50"
    >
      <ShieldCheck strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
      {pending ? t('admin.agentCreate.verifying') : t('admin.agentCreate.verify')}
    </button>
  );
}
