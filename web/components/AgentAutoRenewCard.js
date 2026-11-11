'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { MAISHAPAY_PROVIDER_LABELS } from '@/lib/maishapayRules';
import { setAutoRenewAction } from '@/app/compte/agent/abonnement/actions';
import { useT } from '@/lib/i18n/client';
import { useToast } from './Toast';

/**
 * "Renouvellement automatique" on /compte/agent/abonnement: what happens when
 * the paid period ends, and the switch the checkout's mandate promised
 * ("Arrêt à tout moment depuis l'Espace Agent"). Stopping never shortens the
 * paid period.
 */
export default function AgentAutoRenewCard({ subscription, endLabel }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const on = Boolean(subscription.auto_renew);
  const provider = MAISHAPAY_PROVIDER_LABELS[subscription.renewal_provider] || subscription.renewal_provider;

  const text = !on
    ? t('agent.checkout.renewal.off', { date: endLabel })
    : subscription.renewal_channel === 'mobile_money'
      ? t('agent.checkout.renewal.onMobile', { date: endLabel, provider, last: String(subscription.renewal_phone || '').slice(-4) })
      : t('agent.checkout.renewal.onCard', { date: endLabel });

  function toggle() {
    startTransition(async () => {
      let result;
      try {
        result = await setAutoRenewAction(!on);
      } catch {
        result = { ok: false };
      }
      if (!result?.ok) {
        showToast({ type: 'error', message: t('agent.checkout.renewal.failed') });
        return;
      }
      showToast({
        type: 'success',
        message: on ? t('agent.checkout.renewal.stopped', { date: endLabel }) : t('agent.checkout.renewal.resumed'),
      });
      router.refresh();
    });
  }

  return (
    <div className="u-card flex flex-col gap-3 rounded-card bg-surface p-4 sm:p-6">
      <h2 className="u-title-card flex items-center gap-2 text-ink">
        <RefreshCw strokeWidth={ICON_STROKE_WIDTH} aria-hidden className="h-[1.125rem] w-[1.125rem] text-blue" />
        {t('agent.checkout.renewal.title')}
      </h2>
      <p className="u-micro leading-relaxed text-ink-70">{text}</p>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={
          on
            ? 'u-micro-strong inline-flex min-h-11 items-center justify-center self-start rounded-lg px-4 text-danger ring-1 ring-inset ring-line hover:bg-danger-tint disabled:opacity-60'
            : 'u-btn-primary u-press inline-flex min-h-11 items-center justify-center self-start rounded-lg bg-blue px-4 text-sm font-semibold text-white disabled:opacity-60'
        }
      >
        {on ? t('agent.checkout.renewal.stop') : t('agent.checkout.renewal.resume')}
      </button>
    </div>
  );
}
