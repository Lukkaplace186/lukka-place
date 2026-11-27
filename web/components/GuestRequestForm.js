'use client';

import { useActionState, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import PhoneField from './PhoneField';
import SignupFunnelTracker from './SignupFunnelTracker';
import AccountOfferCard from './AccountOfferCard';
import LocalSavesFields from './LocalSavesFields';
import { OPEN_ACCOUNT_FIELD } from '@/lib/guestAccountRules';
import { useIsLoggedIn } from '@/lib/customerClient';
import { submitGuestRequestAction } from '@/app/(site)/trouver-pour-moi/actions';
import { GUEST_CITY, GUEST_CITY_WIDE, GUEST_REQUEST_TYPES, MAX_GUEST_BEDROOMS, guestCommuneLabel } from '@/lib/guestRequestRules';
import { MOVE_REASONS } from '@/lib/moveProjectRules';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useLocale, useT } from '@/lib/i18n/client';

const INPUT = 'u-focus-ring h-11 w-full rounded-md border border-line bg-white px-3 text-base text-ink sm:text-sm';
const LABEL = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45';

/**
 * "Trouver pour moi" with no account (lib/guestRequestRules.js): what they
 * want, a commune, an optional budget and type, a WhatsApp number. Posts to
 * submitGuestRequestAction, which creates the lead the engine pushes to the
 * commune's agencies. Shown on an empty search (prefilled from it) and on
 * /trouver-pour-moi.
 *
 * "Créer mon compte gratuit" (2026-11-24, ticked by default, hidden when
 * signed in): the same name and number open the account (lib/guestAccount.js),
 * and the confirmation offers the one tap that makes it theirs
 * (AccountOfferCard: send the code from WhatsApp).
 *
 * @param {{communes: string[], prefill?: object, formId?: string}} props
 */
export default function GuestRequestForm({ communes = [], prefill = {}, formId = 'guest-request-form' }) {
  const t = useT();
  const locale = useLocale();
  const loggedIn = useIsLoggedIn();
  const [state, action, pending] = useActionState(submitGuestRequestAction, null);
  const [transactionType, setTransactionType] = useState(prefill.transactionType || 'location');
  const [reasons, setReasons] = useState([]);
  const [formKey, setFormKey] = useState(0);
  // useActionState cannot be reset: "another request" remembers which result
  // it dismissed, and a new submission produces a new state object.
  const [dismissed, setDismissed] = useState(null);

  if (state?.status === 'sent' && state !== dismissed) {
    return (
      <div className="rounded-lg border border-green/40 bg-green-tint px-5 py-6 text-left" role="status">
        <p className="flex items-center gap-2 font-semibold text-green-ink">
          <CheckCircle2 aria-hidden="true" size={20} strokeWidth={ICON_STROKE_WIDTH} />
          {t('listings.guestRequest.sentTitle')}
        </p>
        <p className="mt-2 text-sm text-ink-70">
          {state.last4
            ? t('listings.guestRequest.sentBody', { commune: state.commune, last4: state.last4 })
            : t('listings.guestRequest.sentBodyShort')}
        </p>
        <AccountOfferCard status={state.account} entry="request" next="/compte/client" />
        <button
          type="button"
          onClick={() => {
            setDismissed(state);
            setFormKey((k) => k + 1);
          }}
          className="mt-4 text-sm font-semibold text-blue-deep hover:underline"
        >
          {t('listings.guestRequest.another')}
        </button>
      </div>
    );
  }

  const error = state?.status === 'error' && state !== dismissed ? state.code : null;

  return (
    <form key={formKey} id={formId} action={action} className="flex flex-col gap-3 text-left">
      <input type="hidden" name="transactionType" value={transactionType} />

      {/* People never see or fill this; a bot filling every field does. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${formId}-website`}>Website</label>
        <input id={`${formId}-website`} type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      {/* "Votre situation" (2026-11-07): why they are moving, optional,
          multi — told to the agencies in the request, never deduced. */}
      <input type="hidden" name="reasons" value={reasons.join(',')} />
      <fieldset>
        <legend className={LABEL}>{t('listings.guestRequest.situation')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {MOVE_REASONS.filter((r) => r !== 'autre').map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={reasons.includes(r)}
              onClick={() => setReasons((list) => (list.includes(r) ? list.filter((x) => x !== r) : [...list, r]))}
              className={`min-h-9 rounded-full border px-3 text-[0.8125rem] font-semibold transition-colors ${
                reasons.includes(r) ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-white text-ink-70'
              }`}
            >
              {t(`account.move.steps.reasons.options.${r}`)}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className={LABEL}>{t('listings.guestRequest.transaction')}</legend>
        <div className="grid grid-cols-2 gap-2">
          {[
            ['location', t('listings.guestRequest.rent')],
            ['vente', t('listings.guestRequest.buy')],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={transactionType === value}
              onClick={() => setTransactionType(value)}
              className={`h-11 rounded-md border text-sm font-semibold transition-colors ${
                transactionType === value ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-white text-ink-70'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${formId}-commune`} className={LABEL}>{t('listings.guestRequest.commune')}</label>
        <select id={`${formId}-commune`} name="commune" required defaultValue={prefill.commune || ''} className={INPUT}>
          <option value="" disabled>{t('listings.guestRequest.communePlaceholder')}</option>
          <option value={GUEST_CITY_WIDE}>{t('listings.guestRequest.cityWide', { city: GUEST_CITY })}</option>
          {communes.map((c) => (
            <option key={c} value={c}>{guestCommuneLabel(c)}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${formId}-type`} className={LABEL}>{t('listings.guestRequest.type')}</label>
          <select id={`${formId}-type`} name="propertyType" defaultValue={prefill.propertyType || ''} className={INPUT}>
            <option value="">{t('listings.guestRequest.any')}</option>
            {GUEST_REQUEST_TYPES.map((type) => (
              <option key={type} value={type}>{t(`listings.guestRequest.types.${type}`)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${formId}-beds`} className={LABEL}>{t('listings.guestRequest.bedrooms')}</label>
          <select id={`${formId}-beds`} name="bedrooms" defaultValue={prefill.bedrooms || ''} className={INPUT}>
            <option value="">{t('listings.guestRequest.any')}</option>
            {Array.from({ length: MAX_GUEST_BEDROOMS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}+</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor={`${formId}-budget`} className={LABEL}>
          {transactionType === 'vente' ? t('listings.guestRequest.budgetBuy') : t('listings.guestRequest.budgetRent')}
        </label>
        <input
          id={`${formId}-budget`}
          name="budgetMax"
          type="text"
          inputMode="numeric"
          placeholder={transactionType === 'vente' ? '80000' : '500'}
          defaultValue={prefill.budgetMax || ''}
          className={INPUT}
        />
      </div>

      <div>
        <label htmlFor={`${formId}-name`} className={LABEL}>{t('listings.guestRequest.name')}</label>
        <input id={`${formId}-name`} name="name" type="text" autoComplete="name" maxLength={80} className={INPUT} />
      </div>

      <PhoneField
        name="phone"
        id={`${formId}-phone`}
        locale={locale}
        labels={{ ...phoneFieldLabels(t), label: t('listings.guestRequest.phone') }}
        required
      />

      {loggedIn ? null : (
        <label className="flex items-start gap-2.5 rounded-md bg-blue-tint px-3 py-2.5 text-[0.8125rem] text-ink">
          {/* A ticked box posts "1"; unticked posts nothing, so a hidden "0"
              before it carries the "no" (lib/guestAccountRules.js accountRequested). */}
          <input type="hidden" name={OPEN_ACCOUNT_FIELD} value="0" />
          <input type="checkbox" name={OPEN_ACCOUNT_FIELD} value="1" defaultChecked className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--blue)]" />
          <LocalSavesFields />
          <span>
            <span className="font-semibold">{t('listings.guestRequest.openAccount')}</span>
            <span className="block text-ink-70">{t('listings.guestRequest.openAccountHint')}</span>
          </span>
        </label>
      )}

      {error ? (
        <p className="text-sm text-red-600" role="alert">{t(`listings.guestRequest.errors.${error}`)}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-md bg-blue px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-deep disabled:opacity-60 u-btn-primary"
      >
        {pending ? t('listings.guestRequest.sending') : t('listings.guestRequest.submit')}
      </button>
      <p className="text-xs text-ink-45">{t('listings.guestRequest.privacy')}</p>

      <SignupFunnelTracker formId={formId} form="request" />
    </form>
  );
}
