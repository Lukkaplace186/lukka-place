'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CreditCard, Lock, Smartphone } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { MAISHAPAY_PROVIDER_LABELS, normaliseDrcMobile } from '@/lib/maishapayRules';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import PaymentStatusPanel from './PaymentStatusPanel';

/**
 * The agent's plan checkout (/compte/agent/abonnement/payer), from the
 * "Paiement abonnement agent" design: payment type (automatic or one-off),
 * method (four mobile-money operators or a card), the terms, and a summary
 * with one primary action.
 *
 *   mobile money → POST /api/payments/maishapay/initiate, then the PIN prompt
 *                  is on the phone and this page polls /api/payments/status;
 *   card         → the same POST answers MaishaPay's card page, and the
 *                  browser goes there; it comes back through the callback URL
 *                  to /compte/agent/abonnement/retour.
 *
 * Every figure is the package row's own (price, term, listing allowance).
 * The amount is the plan price: MaishaPay takes its fees on its side.
 */

const MOBILE = ['MPESA', 'ORANGE', 'AIRTEL', 'AFRICELL'];
const POLL_MS = 4000;
const POLL_LIMIT_MS = 3 * 60 * 1000;

function money(amount) {
  return `${Number(amount).toLocaleString('fr-FR')} $`;
}

function ChoiceCard({ name, value, checked, onChange, children, className }) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-card p-4 transition-colors',
        checked ? 'bg-blue-tint ring-2 ring-inset ring-blue' : 'bg-surface ring-1 ring-inset ring-line hover:ring-ink-25',
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-[1.125rem] w-[1.125rem] shrink-0 accent-[var(--blue)]"
      />
      {children}
    </label>
  );
}

function StepHeading({ number, children }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-tint text-sm font-bold text-blue">{number}</span>
      <h2 className="u-title-card text-ink">{children}</h2>
    </div>
  );
}

export default function AgentCheckout({ pkg, trialEndsLabel, defaultPhone = '', termsHref, whatsappHref }) {
  const t = useT();
  const yearly = pkg.term === 'yearly';
  const [billing, setBilling] = useState('auto');
  const [method, setMethod] = useState('MPESA');
  const [network, setNetwork] = useState('VISA');
  const [phone, setPhone] = useState(defaultPhone);
  const [terms, setTerms] = useState(false);
  const [phase, setPhase] = useState('form'); // form | sending | redirecting | waiting | paid | failed | timeout
  const [error, setError] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const pollStarted = useRef(0);

  const isCard = method === 'CARD';
  const providerLabel = isCard ? t('agent.checkout.cardLabel') : MAISHAPAY_PROVIDER_LABELS[method];
  const autoRenew = billing === 'auto';
  const phoneDigits = normaliseDrcMobile(phone);
  const phoneInvalid = !isCard && phone.trim() !== '' && !phoneDigits;
  const canPay = terms && (isCard || Boolean(phoneDigits)) && phase === 'form';

  // While the PIN prompt is on the phone: ask every 4 s, give up after 3 min.
  useEffect(() => {
    if (phase !== 'waiting' || !invoice) return undefined;
    pollStarted.current = Date.now();
    let stopped = false;
    const timer = setInterval(async () => {
      if (stopped) return;
      if (Date.now() - pollStarted.current > POLL_LIMIT_MS) {
        clearInterval(timer);
        setPhase('timeout');
        return;
      }
      try {
        const res = await fetch(`/api/payments/status?invoice=${invoice.invoiceId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'paid') {
          clearInterval(timer);
          setPhase('paid');
        } else if (data.status === 'failed' || data.status === 'cancelled') {
          clearInterval(timer);
          setPhase('failed');
        }
      } catch {
        // A dropped connection is not a verdict: the next tick asks again.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [phase, invoice]);

  async function pay() {
    if (!canPay) return;
    setError(null);
    setPhase('sending');
    let res;
    let data = {};
    try {
      res = await fetch('/api/payments/maishapay/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: pkg.id,
          channel: isCard ? 'card' : 'mobile_money',
          provider: isCard ? network : method,
          phone: isCard ? null : phone,
          autoRenew,
          acceptedTerms: terms,
        }),
      });
      data = await res.json().catch(() => ({}));
    } catch {
      setPhase('form');
      setError('generic');
      return;
    }
    if (!res.ok) {
      setPhase('form');
      setError(['phone', 'provider', 'package', 'terms', 'pending_exists', 'not_configured', 'no_agency'].includes(data.error) ? data.error : 'generic');
      return;
    }
    setInvoice(data);
    if (isCard) {
      if (!data.paymentUrl) {
        setPhase('form');
        setError('provider');
        return;
      }
      setPhase('redirecting');
      window.location.assign(data.paymentUrl);
      return;
    }
    setPhase('waiting');
  }

  function backToForm() {
    setInvoice(null);
    setError(null);
    setPhase('form');
  }

  if (phase === 'waiting') {
    return (
      <PaymentStatusPanel
        state="waiting"
        title={t('agent.checkout.waitingTitle')}
        body={t('agent.checkout.waitingBody', { amount: money(pkg.price), provider: providerLabel, last: (phoneDigits || '').slice(-4) })}
        summary={`${pkg.title} · ${providerLabel}`}
        amount={money(pkg.price)}
        secondary={{ label: t('agent.checkout.changeMethod'), onClick: backToForm }}
      />
    );
  }
  if (phase === 'paid' || phase === 'failed' || phase === 'timeout') {
    return (
      <PaymentStatusPanel
        state={phase}
        planTitle={pkg.title}
        reference={invoice?.reference}
        amount={money(pkg.price)}
        summary={`${pkg.title} · ${providerLabel}`}
        onRetry={backToForm}
        onCheckAgain={() => setPhase('waiting')}
        whatsappHref={whatsappHref}
      />
    );
  }

  const periodLabel = t(yearly ? 'agent.checkout.periodYearly' : 'agent.checkout.periodMonthly');
  const billingOptions = [
    {
      value: 'auto',
      label: t('agent.checkout.autoLabel'),
      body: t(yearly ? 'agent.checkout.autoBodyYearly' : 'agent.checkout.autoBodyMonthly'),
      recommended: true,
    },
    { value: 'once', label: t('agent.checkout.onceLabel', { period: periodLabel }), body: t('agent.checkout.onceBody') },
  ];
  const methods = [
    // "Mobile money" is the operators' own name for the service, in both languages.
    ...MOBILE.map((code) => ({ value: code, label: MAISHAPAY_PROVIDER_LABELS[code], sub: 'Mobile money', Icon: Smartphone })),
    { value: 'CARD', label: t('agent.checkout.cardLabel'), sub: t('agent.checkout.cardSub'), Icon: CreditCard },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-2xl flex-col gap-2">
        <span className="u-eyebrow text-blue">{t('agent.checkout.eyebrow')}</span>
        <h1 className="u-title-section text-ink">{t('agent.checkout.heading', { plan: pkg.title })}</h1>
        <p className="u-body text-ink-70">{trialEndsLabel ? t('agent.checkout.trialEnds', { date: trialEndsLabel }) : t('agent.checkout.intro')}</p>
      </div>

      <div className="flex flex-wrap items-start gap-8">
        <div className="flex min-w-0 flex-[999_1_34rem] flex-col">
          <section className="flex flex-col gap-4 pb-8">
            <StepHeading number={1}>{t('agent.checkout.billingTitle')}</StepHeading>
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="sr-only">{t('agent.checkout.billingTitle')}</legend>
              {billingOptions.map((opt) => (
                <ChoiceCard key={opt.value} name="billing" value={opt.value} checked={billing === opt.value} onChange={() => setBilling(opt.value)}>
                  <span className="flex flex-col gap-1.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="u-title-sub text-ink">{opt.label}</span>
                      {opt.recommended && (
                        <span className="rounded-full bg-blue px-2.5 py-0.5 text-[0.6875rem] font-semibold text-white">{t('agent.checkout.recommended')}</span>
                      )}
                    </span>
                    <span className="u-micro leading-relaxed text-ink-70">{opt.body}</span>
                  </span>
                </ChoiceCard>
              ))}
            </fieldset>
          </section>

          <section className="flex flex-col gap-4 border-t border-line pt-8">
            <StepHeading number={2}>{t('agent.checkout.methodTitle')}</StepHeading>
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="sr-only">{t('agent.checkout.methodLegend')}</legend>
              {methods.map(({ value, label, sub, Icon }) => (
                <ChoiceCard key={value} name="method" value={value} checked={method === value} onChange={() => setMethod(value)} className="items-center">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="u-title-sub text-ink">{label}</span>
                    <span className="u-micro text-ink-45">{sub}</span>
                  </span>
                  <Icon strokeWidth={ICON_STROKE_WIDTH} aria-hidden className={cn('h-5 w-5 shrink-0', method === value ? 'text-blue' : 'text-ink-35')} />
                </ChoiceCard>
              ))}
            </fieldset>

            {isCard ? (
              <div className="flex flex-col gap-3 rounded-card bg-blue-tint p-4">
                <fieldset className="flex flex-wrap gap-2">
                  <legend className="u-micro-strong mb-2 text-ink">{t('agent.checkout.networkLegend')}</legend>
                  {['VISA', 'MASTERCARD'].map((code) => (
                    <label
                      key={code}
                      className={cn(
                        'u-micro-strong inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg px-4',
                        network === code ? 'bg-blue text-white' : 'bg-surface text-ink ring-1 ring-inset ring-line',
                      )}
                    >
                      <input type="radio" name="network" value={code} checked={network === code} onChange={() => setNetwork(code)} className="sr-only" />
                      {MAISHAPAY_PROVIDER_LABELS[code]}
                    </label>
                  ))}
                </fieldset>
                <p className="u-micro leading-relaxed text-ink-70">{t('agent.checkout.cardNote')}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 rounded-card bg-canvas-alt p-4">
                <label htmlFor="mm-phone" className="u-micro-strong text-ink">
                  {t('agent.checkout.phoneLabel', { provider: providerLabel })}
                </label>
                <div className={cn('flex h-12 items-center rounded-lg border bg-surface focus-within:ring-2 focus-within:ring-blue/30', phoneInvalid ? 'border-danger' : 'border-ink-25 focus-within:border-blue')}>
                  <span className="u-tabular border-r border-line px-3 text-sm font-semibold text-ink-70">+243</span>
                  <input
                    id="mm-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="81 234 5678"
                    aria-invalid={phoneInvalid || undefined}
                    aria-describedby="mm-phone-hint"
                    className="u-tabular h-full min-w-0 flex-1 rounded-r-lg bg-transparent px-3 text-[0.9375rem] text-ink placeholder:text-ink-35 focus:outline-none"
                  />
                </div>
                <p id="mm-phone-hint" className={cn('u-micro leading-relaxed', phoneInvalid ? 'text-danger' : 'text-ink-45')}>
                  {phoneInvalid ? t('agent.checkout.errors.phone') : t('agent.checkout.phoneHint')}
                </p>
              </div>
            )}

            <label className="flex cursor-pointer items-start gap-3 pt-2 text-sm leading-relaxed text-ink-70">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 h-[1.125rem] w-[1.125rem] shrink-0 accent-[var(--blue)]" />
              <span>
                {t('agent.checkout.termsBefore')}{' '}
                <Link href={termsHref} target="_blank" className="font-semibold text-blue underline underline-offset-[3px] hover:text-blue-deep">
                  {t('agent.checkout.termsLink')}
                </Link>
                {t('agent.checkout.termsAfter')}
                {autoRenew && <> {t(yearly ? 'agent.checkout.mandateYearly' : 'agent.checkout.mandateMonthly', { amount: money(pkg.price) })}</>}
              </span>
            </label>
          </section>
        </div>

        <aside aria-label={t('agent.checkout.summaryTitle')} className="u-card min-w-0 max-w-full flex-[1_1_22rem] overflow-hidden rounded-card bg-surface lg:sticky lg:top-24">
          <div className="flex flex-col gap-1 bg-blue px-6 py-5 text-white">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-white/80">{t('agent.checkout.yourPlan')}</span>
            <span className="text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">{pkg.title}</span>
          </div>
          <div className="flex flex-col gap-5 p-6">
            <div className="flex items-baseline gap-2">
              <span className="u-stat u-tabular text-ink">{money(pkg.price)}</span>
              <span className="u-micro text-ink-45">{t(yearly ? 'agent.checkout.perYear' : 'agent.checkout.perMonth')}</span>
            </div>

            <dl className="flex flex-col gap-3 border-t border-line pt-4 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-45">{t('agent.checkout.listingsRow')}</dt>
                <dd className="font-semibold text-ink">
                  {pkg.number_of_property == null ? t('agent.plans.unlimitedListings') : t('agent.plans.listingsIncluded', { count: pkg.number_of_property })}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-45">{t('agent.checkout.methodRow')}</dt>
                <dd className="font-semibold text-ink">{isCard ? MAISHAPAY_PROVIDER_LABELS[network] : providerLabel}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-45">{t('agent.checkout.renewalRow')}</dt>
                <dd className="text-right font-semibold text-ink">
                  {autoRenew ? t(yearly ? 'agent.checkout.renewalAutoYearly' : 'agent.checkout.renewalAutoMonthly') : t('agent.checkout.renewalNone')}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
                <dt className="font-bold text-ink">{t('agent.checkout.total')}</dt>
                <dd className="u-tabular text-2xl font-extrabold tracking-[-0.02em] text-ink">{money(pkg.price)}</dd>
              </div>
            </dl>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={pay}
                disabled={!canPay}
                className="u-btn-primary u-press inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-blue px-5 text-base font-semibold text-white disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-35"
              >
                {phase === 'sending'
                  ? t('agent.checkout.sending')
                  : phase === 'redirecting'
                    ? t('agent.checkout.redirecting')
                    : isCard
                      ? t('agent.checkout.payCard')
                      : t('agent.checkout.payMobile', { amount: money(pkg.price), provider: providerLabel })}
                <ArrowRight strokeWidth={2} aria-hidden className="h-[1.125rem] w-[1.125rem]" />
              </button>
              {!terms && <p className="u-micro text-center text-ink-45">{t('agent.checkout.acceptFirst')}</p>}
              {error && (
                <p role="alert" className="u-micro rounded-lg bg-danger-tint px-3 py-2.5 text-danger">
                  {t(`agent.checkout.errors.${error}`)}
                </p>
              )}
            </div>

            <p className="u-micro flex items-start gap-2 leading-relaxed text-ink-45">
              <Lock strokeWidth={2} aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              {t('agent.checkout.secure')}
            </p>
            {whatsappHref && (
              <a href={whatsappHref} target="_blank" rel="noopener" className="u-micro-strong text-blue underline-offset-[3px] hover:underline">
                {t('agent.checkout.help')}
              </a>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
