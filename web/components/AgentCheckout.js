'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Camera, Check, CircleAlert, Loader2, Lock, Smartphone, Star } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { photoPerkLines } from '@/lib/photoAllowance';
import { normaliseMobileMoneyPhone } from '@/lib/flexpaieRules';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import {
  DEFAULT_OPERATOR,
  MOBILE_MONEY_OPERATORS,
  STATUS_POLL_LIMIT_MS,
  STATUS_POLL_MS,
  formatUsd,
  initiateErrorKey,
  operatorById,
} from '@/lib/checkoutRules';
import { useT } from '@/lib/i18n/client';

/** The local part of a stored DRC number ("243812345678" → "812345678"), else ''. */
function localDigits(stored) {
  const e164 = normaliseMobileMoneyPhone(stored);
  return e164 ? e164.slice(3) : '';
}

/**
 * The checkout form and its payment states, after the "Paiement abonnement
 * agent" design: plan summary, the agent's details, the mobile-money
 * operator, terms, and one pay button. Unlike the design there is no
 * automatic monthly debit and no card option — lib/checkoutRules.js says why.
 *
 * States: form → waiting (FlexPaie has pushed the prompt; we poll /status)
 * → paid | failed | timeout. Paid refreshes the router so the Abonnement page
 * and the sidebar show the new plan.
 */
export default function AgentCheckout({ pkg, agencyName, agentPhone, hasAgency, onlinePaymentOpen }) {
  const t = useT();
  const router = useRouter();
  const [phone, setPhone] = useState(() => localDigits(agentPhone));
  const [operator, setOperator] = useState(DEFAULT_OPERATOR);
  const [accepted, setAccepted] = useState(false);
  const [stage, setStage] = useState('form'); // form | sending | waiting | paid | failed | timeout
  const [error, setError] = useState(null);
  const [invoice, setInvoice] = useState(null); // {invoiceId, reference}
  const pollRef = useRef(null);

  const termLabel = ['monthly', 'yearly', 'lifetime'].includes(pkg.term) ? t(`agent.checkout.term.${pkg.term}`) : pkg.term || '';
  const price = formatUsd(pkg.price);
  const priority = Number(pkg.priority_multiplier) || 1;
  const perks = [
    {
      Icon: Check,
      text: pkg.number_of_property == null
        ? t('agent.plans.unlimitedListings')
        : t('agent.plans.listingsIncluded', { count: pkg.number_of_property }),
    },
    ...(priority > 1 ? [{ Icon: Star, text: t('agent.checkout.priority', { n: priority }) }] : []),
    ...photoPerkLines({ sessions: pkg.photo_sessions_per_month, discountPct: pkg.photo_discount_pct }, t)
      .map((text) => ({ Icon: Camera, text })),
  ];
  const op = operatorById(operator);

  useEffect(() => () => clearTimeout(pollRef.current), []);

  function poll(invoiceId, startedAt) {
    pollRef.current = setTimeout(async () => {
      if (Date.now() - startedAt > STATUS_POLL_LIMIT_MS) {
        setStage('timeout');
        return;
      }
      try {
        const res = await fetch(`/api/payments/flexpaie/status?invoice=${invoiceId}`, { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (body.status === 'paid') {
          setStage('paid');
          router.refresh();
          return;
        }
        if (body.status === 'failed') {
          setStage('failed');
          return;
        }
      } catch {
        // A dropped connection while polling is not a verdict: keep asking.
      }
      poll(invoiceId, startedAt);
    }, STATUS_POLL_MS);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    if (!normaliseMobileMoneyPhone(phone)) {
      setError(t('agent.checkout.errors.phone'));
      return;
    }
    if (!accepted) {
      setError(t('agent.checkout.errors.terms'));
      return;
    }
    setStage('sending');
    try {
      const res = await fetch('/api/payments/flexpaie/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: pkg.id, phone }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.invoiceId) {
        setStage('form');
        setError(t(initiateErrorKey(body.error)));
        return;
      }
      setInvoice(body);
      setStage('waiting');
      poll(body.invoiceId, Date.now());
    } catch {
      setStage('form');
      setError(t('agent.checkout.errors.network'));
    }
  }

  function retry() {
    clearTimeout(pollRef.current);
    setInvoice(null);
    setStage('form');
  }

  const teamHref = getCentralWhatsAppHref(
    t('agent.checkout.whatsappHelp', { plan: pkg.title || '', ref: invoice?.reference || '—' }),
  );

  const summary = (
    <section aria-label={t('agent.checkout.summary')} className="u-card overflow-hidden rounded-card bg-surface">
      <div className="flex items-center justify-between gap-3 bg-blue px-5 py-4 text-white">
        <div className="min-w-0">
          <div className="u-eyebrow text-white/85">{t('agent.checkout.yourPlan')}</div>
          <div className="truncate text-2xl font-extrabold tracking-tight">{pkg.title || t('agent.checkout.plan')}</div>
        </div>
        <div className="u-tabular shrink-0 text-right text-xl font-extrabold tracking-tight">
          {price}
          <span className="block text-[0.8125rem] font-medium text-white/90">{termLabel}</span>
        </div>
      </div>
      <ul className="flex flex-col gap-2.5 px-5 py-4">
        {perks.map(({ Icon, text }) => (
          <li key={text} className="u-micro flex items-start gap-2.5 text-ink-70">
            <Icon strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-blue" aria-hidden="true" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );

  if (stage === 'waiting' || stage === 'paid' || stage === 'failed' || stage === 'timeout') {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
        <div className="u-card flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-10 text-center" role="status" aria-live="polite">
          {stage === 'waiting' && (
            <>
              <Smartphone strokeWidth={ICON_STROKE_WIDTH} className="h-9 w-9 text-blue" aria-hidden="true" />
              <h2 className="u-title-section text-ink">{t('agent.checkout.waiting.title')}</h2>
              <p className="u-micro max-w-sm leading-relaxed text-ink-70">
                {t('agent.checkout.waiting.body', { operator: op.label, amount: price })}
              </p>
              <Loader2 className="h-5 w-5 animate-spin text-ink-45" aria-hidden="true" />
            </>
          )}
          {stage === 'paid' && (
            <>
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-green text-white">
                <Check strokeWidth={2.5} className="h-6 w-6" aria-hidden="true" />
              </span>
              <h2 className="u-title-section text-ink">{t('agent.checkout.paid.title')}</h2>
              <p className="u-micro max-w-sm leading-relaxed text-ink-70">{t('agent.checkout.paid.body', { plan: pkg.title || '' })}</p>
              <Link href="/compte/agent/abonnement" className="u-btn-primary u-press mt-2 inline-flex h-11 items-center justify-center rounded-lg bg-blue px-5 text-sm font-bold text-white">
                {t('agent.checkout.paid.cta')}
              </Link>
            </>
          )}
          {(stage === 'failed' || stage === 'timeout') && (
            <>
              <CircleAlert strokeWidth={ICON_STROKE_WIDTH} className="h-9 w-9 text-warning" aria-hidden="true" />
              <h2 className="u-title-section text-ink">{t(`agent.checkout.${stage}.title`)}</h2>
              <p className="u-micro max-w-sm leading-relaxed text-ink-70">{t(`agent.checkout.${stage}.body`)}</p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={retry} className="u-btn-primary u-press inline-flex h-11 items-center justify-center rounded-lg bg-blue px-5 text-sm font-bold text-white">
                  {t('agent.checkout.tryAgain')}
                </button>
                {teamHref && (
                  <a href={teamHref} target="_blank" rel="noopener noreferrer" className="u-btn-secondary inline-flex h-11 items-center justify-center rounded-lg px-5 text-sm font-bold">
                    {t('agent.checkout.contactTeam')}
                  </a>
                )}
              </div>
            </>
          )}
          {invoice?.reference && (
            <p className="u-micro mt-2 text-ink-45">
              {t('agent.checkout.reference')} <span className="u-ref">{invoice.reference}</span>
            </p>
          )}
        </div>
        {summary}
      </div>
    );
  }

  const blocked = !onlinePaymentOpen || !hasAgency;

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <span className="u-eyebrow text-blue">{t('agent.checkout.eyebrow')}</span>
          <h1 className="u-title-page text-ink">{t('agent.checkout.heading', { plan: pkg.title || '' })}</h1>
          <p className="u-micro leading-relaxed text-ink-70">{t('agent.checkout.intro')}</p>
        </div>

        {!onlinePaymentOpen && (
          <div className="u-micro rounded-lg bg-warning-tint px-4 py-3 leading-relaxed text-warning">
            {t('agent.checkout.notOpen')}
          </div>
        )}
        {onlinePaymentOpen && !hasAgency && (
          <div className="u-micro rounded-lg bg-warning-tint px-4 py-3 leading-relaxed text-warning">
            {t('agent.checkout.errors.noAgency')}
          </div>
        )}

        <div className="lg:hidden">{summary}</div>

        <section className="u-card flex flex-col gap-4 rounded-card bg-surface p-4 sm:p-6">
          <h2 className="u-title-card text-ink">{t('agent.checkout.yourDetails')}</h2>
          <div className="flex flex-col gap-1.5">
            <span className="u-micro-strong text-ink">{t('agent.checkout.agency')}</span>
            <span className="u-micro text-ink-70">{agencyName || t('agent.checkout.agencyUnknown')}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="checkout-phone" className="u-micro-strong text-ink">
              {t('agent.checkout.phoneLabel', { operator: op.label })}
            </label>
            <div className="flex h-12 items-stretch overflow-hidden rounded-lg border border-ink-25 bg-surface focus-within:ring-2 focus-within:ring-blue">
              <span className="u-micro-strong flex items-center border-r border-line bg-canvas-alt px-3 text-ink-70">+243</span>
              <input
                id="checkout-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="81 234 5678"
                className="min-w-0 flex-1 bg-transparent px-3 text-[0.9375rem] text-ink outline-none"
                aria-describedby="checkout-phone-hint"
              />
            </div>
            <p id="checkout-phone-hint" className="u-micro text-ink-45">{t('agent.checkout.phoneHint')}</p>
          </div>
        </section>

        <section className="u-card flex flex-col gap-3 rounded-card bg-surface p-4 sm:p-6">
          <h2 className="u-title-card text-ink">{t('agent.checkout.method')}</h2>
          <fieldset className="flex flex-col gap-2.5">
            <legend className="sr-only">{t('agent.checkout.method')}</legend>
            {MOBILE_MONEY_OPERATORS.map((o) => {
              const checked = operator === o.id;
              return (
                <label
                  key={o.id}
                  className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-xl px-4 py-3 ${
                    checked ? 'bg-blue-tint ring-2 ring-inset ring-blue' : 'ring-1 ring-inset ring-ink-25'
                  }`}
                >
                  <input
                    type="radio"
                    name="operator"
                    value={o.id}
                    checked={checked}
                    onChange={() => setOperator(o.id)}
                    className="h-[1.125rem] w-[1.125rem] accent-[var(--color-blue)]"
                  />
                  <span className="flex flex-col">
                    <span className="text-[0.9375rem] font-bold text-ink">{o.label}</span>
                    <span className="u-micro text-ink-45">{o.network}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <div className="mt-1 flex flex-col gap-1 rounded-xl bg-blue-tint p-4">
            <span className="u-micro-strong text-ink">{t('agent.checkout.howTitle')}</span>
            <span className="u-micro leading-relaxed text-ink-70">{t('agent.checkout.howBody', { operator: op.label })}</span>
          </div>
          <p className="u-micro text-ink-45">{t('agent.checkout.cardSoon')}</p>
        </section>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-28">
        <div className="hidden lg:block">{summary}</div>
        <div className="u-card flex flex-col gap-4 rounded-card bg-surface p-4 sm:p-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex flex-col">
              <span className="u-micro-strong text-ink">{t('agent.checkout.total')}</span>
              <span className="u-micro text-ink-45">{t('agent.checkout.oneOff', { term: termLabel })}</span>
            </span>
            <span className="u-tabular text-[1.375rem] font-extrabold tracking-tight text-ink">{price}</span>
          </div>
          <label className="u-micro flex items-start gap-3 leading-relaxed text-ink-70">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-0.5 h-[1.125rem] w-[1.125rem] shrink-0 accent-[var(--color-blue)]"
            />
            <span>
              {t('agent.checkout.termsBefore')}{' '}
              <Link href="/conditions" target="_blank" className="font-semibold text-blue underline underline-offset-2">
                {t('agent.checkout.termsLink')}
              </Link>
              {t('agent.checkout.termsAfter', { amount: price })}
            </span>
          </label>
          {error && (
            <p role="alert" className="u-micro rounded-lg bg-warning-tint px-3 py-2 text-warning">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={blocked || stage === 'sending'}
            className="u-btn-primary u-press inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-blue px-4 text-base font-semibold text-white disabled:opacity-60"
          >
            {stage === 'sending' ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                {t('agent.checkout.sending')}
              </>
            ) : (
              <>
                {t('agent.checkout.pay', { amount: price })}
                <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
              </>
            )}
          </button>
          <p className="u-micro flex items-start gap-2 leading-relaxed text-ink-45">
            <Lock strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t('agent.checkout.secure')}</span>
          </p>
        </div>
      </aside>
    </form>
  );
}
