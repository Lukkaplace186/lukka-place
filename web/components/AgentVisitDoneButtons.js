'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, MessageCircle, XCircle } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { useToast } from './Toast';
import { recordVisitOutcomeAction } from '@/app/compte/agent/visitOutcomeActions';
import { receiptWhatsAppHref } from '@/lib/visitOutcome';

/**
 * "Visite effectuée" / "Pas eu lieu" on a confirmed visit whose slot has
 * started (lib/visitOutcome.js). DONE sends the customer the bon de visite
 * from Lukka Place's number, then offers the same text from the agent's own
 * WhatsApp — which lands even when ours cannot (the 24 h window).
 */
export default function AgentVisitDoneButtons({ viewingRequestId }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [receipt, setReceipt] = useState(null);

  function answer(outcome) {
    startTransition(async () => {
      let result;
      try {
        result = await recordVisitOutcomeAction(viewingRequestId, outcome);
      } catch {
        result = { ok: false, error: t('agent.agenda.done.failed') };
      }
      showToast({ type: result.ok ? 'success' : 'error', message: result.ok ? result.message : result.error });
      if (result.ok && result.receiptText) setReceipt(receiptWhatsAppHref(result.customerWaId, result.receiptText));
      if (result.ok && !result.receiptText) router.refresh();
    });
  }

  const button = 'u-press inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[0.8125rem] font-semibold sm:flex-none disabled:opacity-50';

  if (receipt) {
    return (
      <a href={receipt} target="_blank" rel="noopener noreferrer" onClick={() => router.refresh()} className={`${button} bg-green-deep text-white`}>
        <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        {t('agent.agenda.done.sendFromMine')}
      </a>
    );
  }

  return (
    <>
      <button type="button" disabled={pending} onClick={() => answer('DONE')} className={`${button} bg-blue text-white`}>
        <CheckCircle2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        {t('agent.agenda.done.done')}
      </button>
      <button type="button" disabled={pending} onClick={() => answer('NOT_DONE')} className={`${button} border border-line text-ink-70`}>
        <XCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        {t('agent.agenda.done.notDone')}
      </button>
    </>
  );
}
