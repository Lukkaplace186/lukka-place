'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/client';
import PaymentStatusPanel from './PaymentStatusPanel';

/**
 * The card-payment return (/compte/agent/abonnement/retour): shows the
 * invoice's state and, while MaishaPay has not given a verdict yet, asks
 * /api/payments/status every 4 s for up to 3 minutes before saying "no
 * confirmation yet" (never "failed" — the card may still be charged).
 */
const POLL_MS = 4000;
const POLL_LIMIT_MS = 3 * 60 * 1000;

function toState(status) {
  if (status === 'paid') return 'paid';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'waiting';
}

export default function PaymentReturn({ invoiceId, initialStatus, reference, planTitle, amount, packageId, whatsappHref }) {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState(toState(initialStatus));
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (state !== 'waiting') return undefined;
    const started = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - started > POLL_LIMIT_MS) {
        clearInterval(timer);
        setState('timeout');
        return;
      }
      try {
        const res = await fetch(`/api/payments/status?invoice=${invoiceId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const next = toState((await res.json()).status);
        if (next !== 'waiting') {
          clearInterval(timer);
          setState(next);
        }
      } catch {
        // Offline for a moment: the next tick asks again.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [state, invoiceId, round]);

  return (
    <PaymentStatusPanel
      state={state}
      title={state === 'waiting' ? t('agent.checkout.timeoutTitle') : undefined}
      body={state === 'waiting' ? t('agent.checkout.timeoutBody') : undefined}
      planTitle={planTitle}
      reference={reference}
      amount={amount}
      summary={planTitle}
      onRetry={packageId ? () => router.push(`/compte/agent/abonnement/payer?forfait=${packageId}`) : undefined}
      onCheckAgain={() => {
        setRound((n) => n + 1);
        setState('waiting');
      }}
      whatsappHref={whatsappHref}
    />
  );
}
