'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import PhoneField from '@/components/PhoneField';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { formatPhoneDisplay } from '@/lib/phone';
import { useLocale, useT } from '@/lib/i18n/client';

const BUTTON = 'u-btn-primary u-press inline-flex h-11 w-full items-center justify-center rounded-full bg-blue px-6 text-[0.9375rem] font-semibold text-white disabled:opacity-60';
const LINK = 'text-[0.875rem] font-semibold text-blue underline-offset-2 hover:underline disabled:opacity-60';

function Submit({ label, busyLabel }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={BUTTON}>
      {pending ? busyLabel : label}
    </button>
  );
}

function ErrorLine({ error }) {
  const t = useT();
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-[0.8125rem] text-danger">
      {t(`account.phoneChange.errors.${error}`)}
    </p>
  );
}

/**
 * The two steps of "Changer de numéro". Step 1 is the sign-up's own phone
 * field; step 2 is the 6-digit code, with "Renvoyer le code" (same number,
 * sent again) and "Modifier le numéro" (back to step 1).
 */
export default function PhoneChangeForm({ initialStep, pendingPhone, defaultCountry, sendAction, confirmAction, cancelAction }) {
  const t = useT();
  const locale = useLocale();
  const [sendState, send] = useActionState(sendAction, { step: initialStep, phone: pendingPhone });
  const [confirmState, confirm] = useActionState(confirmAction, null);
  const [step, setStep] = useState(initialStep);
  const [phone, setPhone] = useState(pendingPhone);
  const [error, setError] = useState(null);
  const [cancelling, startCancel] = useTransition();

  // The latest answer from either action decides the step and the message.
  useEffect(() => {
    if (!sendState) return;
    if (sendState.phone) setPhone(sendState.phone);
    if (sendState.step) setStep(sendState.step);
    setError(sendState.error || null);
  }, [sendState]);
  useEffect(() => {
    if (!confirmState) return;
    if (confirmState.step) setStep(confirmState.step);
    setError(confirmState.error || null);
  }, [confirmState]);

  function changeNumber() {
    startCancel(async () => {
      try {
        await cancelAction();
      } catch {
        // Nothing to undo: a code left waiting simply expires.
      }
      setError(null);
      setStep('phone');
    });
  }

  if (step === 'code' && phone) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[0.9375rem] text-ink">
          {t('account.phoneChange.codeSent', { phone: formatPhoneDisplay(phone) })}
        </p>
        <form action={confirm} className="flex flex-col gap-3">
          <label htmlFor="code" className="u-eyebrow block">{t('account.phoneChange.codeLabel')}</label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            className="u-focus-ring h-12 w-full rounded-md border border-line bg-white px-3 text-center text-[1.25rem] tracking-[0.3em] text-ink"
          />
          <ErrorLine error={error} />
          <Submit label={t('account.phoneChange.confirm')} busyLabel={t('account.phoneChange.confirming')} />
        </form>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <form action={send}>
            <input type="hidden" name="phone" value={`+${phone}`} />
            <ResendButton />
          </form>
          <button type="button" onClick={changeNumber} disabled={cancelling} className={LINK}>
            {t('account.phoneChange.editNumber')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={send} className="flex flex-col gap-4">
      <PhoneField
        name="phone"
        id="phone"
        defaultCountry={defaultCountry}
        locale={locale}
        labels={{ ...phoneFieldLabels(t), label: t('account.phoneChange.newNumber') }}
        hint={t('account.phoneChange.hint')}
        autoFocus
        required
      />
      <ErrorLine error={error} />
      <Submit label={t('account.phoneChange.sendCode')} busyLabel={t('account.phoneChange.sending')} />
    </form>
  );
}

function ResendButton() {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={LINK}>
      {pending ? t('account.phoneChange.sending') : t('account.phoneChange.resend')}
    </button>
  );
}
