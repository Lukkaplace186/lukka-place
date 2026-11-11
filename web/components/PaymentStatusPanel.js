'use client';

import Link from 'next/link';
import { Check, CircleAlert, Clock3, Smartphone } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

/**
 * One centred card for every moment after the agent pressed "Payer":
 * waiting (PIN prompt on the phone), paid, failed, and timeout (no verdict
 * after three minutes — never presented as a failure, since money may still
 * move). Shared by the checkout (components/AgentCheckout.js) and the return
 * page after MaishaPay's card page (/compte/agent/abonnement/retour).
 */
const TONES = {
  waiting: { Icon: Smartphone, ring: 'bg-blue-tint text-blue' },
  paid: { Icon: Check, ring: 'bg-green text-white' },
  failed: { Icon: CircleAlert, ring: 'bg-danger-tint text-danger' },
  timeout: { Icon: Clock3, ring: 'bg-warning-tint text-warning-ink' },
};

export default function PaymentStatusPanel({
  state,
  title,
  body,
  planTitle,
  reference,
  amount,
  summary,
  secondary,
  onRetry,
  onCheckAgain,
  whatsappHref,
}) {
  const t = useT();
  const { Icon, ring } = TONES[state] || TONES.waiting;
  const heading = title || {
    paid: t('agent.checkout.paidTitle'),
    failed: t('agent.checkout.failedTitle'),
    timeout: t('agent.checkout.timeoutTitle'),
  }[state];
  const text = body || {
    paid: t('agent.checkout.paidBody', { plan: planTitle || '' }),
    failed: t('agent.checkout.failedBody'),
    timeout: t('agent.checkout.timeoutBody'),
  }[state];

  return (
    <section
      aria-live="polite"
      className="u-card mx-auto flex w-full max-w-xl flex-col items-center gap-5 rounded-card bg-surface px-6 py-10 text-center sm:px-10"
    >
      <span className={cn('flex h-16 w-16 items-center justify-center rounded-full', ring)}>
        <Icon strokeWidth={state === 'paid' ? 2.25 : ICON_STROKE_WIDTH} aria-hidden className="h-7 w-7" />
      </span>
      <h1 className="u-title-section text-ink">{heading}</h1>
      {text && <p className="u-body max-w-md text-ink-70">{text}</p>}

      {(summary || amount) && (
        <dl className="flex w-full flex-col gap-2 rounded-lg bg-canvas-alt px-4 py-3.5 text-left text-sm">
          {summary && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-45">{summary}</dt>
              {amount && <dd className="u-tabular font-bold text-ink">{amount}</dd>}
            </div>
          )}
          {state === 'paid' && reference && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-45">{t('agent.checkout.paidRef')}</dt>
              <dd className="u-ref text-ink">{reference}</dd>
            </div>
          )}
        </dl>
      )}

      {state === 'waiting' && (
        <p role="status" className="u-micro-strong inline-flex items-center gap-2 text-ink-45">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue" />
          </span>
          {t('agent.checkout.waitingStatus')}
        </p>
      )}

      <div className="flex w-full flex-col gap-2.5">
        {state === 'paid' && (
          <>
            <Link href="/compte/agent/biens" className="u-btn-primary u-press inline-flex min-h-14 w-full items-center justify-center rounded-lg bg-blue px-5 text-base font-semibold text-white">
              {t('agent.checkout.publishListing')}
            </Link>
            <Link href="/compte/agent/abonnement" className="u-btn-secondary u-press inline-flex min-h-12 w-full items-center justify-center rounded-lg px-5 text-sm font-semibold">
              {t('agent.checkout.goSubscription')}
            </Link>
          </>
        )}
        {state === 'failed' && onRetry && (
          <button type="button" onClick={onRetry} className="u-btn-primary u-press inline-flex min-h-14 w-full items-center justify-center rounded-lg bg-blue px-5 text-base font-semibold text-white">
            {t('agent.checkout.tryAgain')}
          </button>
        )}
        {state === 'timeout' && onCheckAgain && (
          <button type="button" onClick={onCheckAgain} className="u-btn-primary u-press inline-flex min-h-14 w-full items-center justify-center rounded-lg bg-blue px-5 text-base font-semibold text-white">
            {t('agent.checkout.checkAgain')}
          </button>
        )}
        {(state === 'failed' || state === 'timeout') && (
          <Link href="/compte/agent/abonnement" className="u-btn-secondary u-press inline-flex min-h-12 w-full items-center justify-center rounded-lg px-5 text-sm font-semibold">
            {t('agent.checkout.goSubscription')}
          </Link>
        )}
        {secondary && (
          <button type="button" onClick={secondary.onClick} className="u-micro-strong inline-flex min-h-11 w-full items-center justify-center rounded-lg text-blue hover:bg-blue-tint">
            {secondary.label}
          </button>
        )}
      </div>

      {(state === 'failed' || state === 'timeout') && whatsappHref && (
        <a href={whatsappHref} target="_blank" rel="noopener" className="u-micro-strong text-blue underline-offset-[3px] hover:underline">
          {t('agent.checkout.help')}
        </a>
      )}
    </section>
  );
}
