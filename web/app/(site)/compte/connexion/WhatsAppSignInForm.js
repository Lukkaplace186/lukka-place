'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import PhoneField from '@/components/PhoneField';
import { WhatsAppIcon } from '@/components/WhatsAppCTA';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useLocale, useT } from '@/lib/i18n/client';
import { startWhatsAppSignInAction } from './whatsappActions';

const ERROR_KEYS = {
  phone: 'auth.errors.phoneInvalid',
  name: 'auth.whatsappSignIn.errors.name',
  busy: 'auth.whatsappSignIn.errors.busy',
};

function ContinueButton({ label }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="u-press u-focus-ring flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#1E7B54] px-4 text-[0.9375rem] font-semibold text-white disabled:opacity-60"
    >
      {pending ? (
        <Loader2 strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 animate-spin" aria-hidden="true" />
      ) : (
        <WhatsAppIcon className="h-5 w-5" />
      )}
      {label}
    </button>
  );
}

/**
 * "Continuer avec WhatsApp": the number, then — only for a number we do not
 * know — the name, on the same form. No password. The action opens (or
 * finds) the account and hands over to the code screen.
 */
export default function WhatsAppSignInForm({ next, entry = 'whatsapp', defaultCountry, defaultPhone = '', onSubmit }) {
  const t = useT();
  const locale = useLocale();
  const [state, formAction] = useActionState(startWhatsAppSignInAction, null);
  const values = state?.values || null;
  const phoneValue = values ? values.phone : defaultPhone;
  const needName = Boolean(state?.needName);
  const errorKey = state?.error ? ERROR_KEYS[state.error] : null;

  return (
    <form action={formAction} onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="entry" value={entry} />
      <PhoneField
        key={state?.attempt || 'first'}
        name="phone"
        id="wa-phone"
        defaultCountry={(values && values.phoneCountry) || defaultCountry}
        defaultValue={phoneValue}
        detectCountry={!phoneValue}
        locale={locale}
        labels={phoneFieldLabels(t)}
        required
      />
      {needName ? (
        <div>
          <label htmlFor="wa-name" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
            {t('auth.whatsappSignIn.nameLabel')}
          </label>
          <input
            id="wa-name"
            name="name"
            autoComplete="name"
            autoFocus
            required
            defaultValue={values?.name || ''}
            className="w-full rounded-md border border-line bg-surface px-3 py-2.5 text-[0.9375rem] text-ink outline-none focus:border-blue"
          />
          <p className="mt-1 text-[0.8125rem] text-ink-70">{t('auth.whatsappSignIn.nameHint')}</p>
        </div>
      ) : null}
      {errorKey ? (
        <p className="text-sm text-red-600" role="alert">{t(errorKey)}</p>
      ) : null}
      <ContinueButton label={t('auth.whatsappSignIn.button')} />
      <p className="text-center text-[0.8125rem] text-ink-70">{t('auth.whatsappSignIn.lead')}</p>
    </form>
  );
}
