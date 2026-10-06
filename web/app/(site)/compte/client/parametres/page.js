import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight, Coins, KeyRound, Languages, LogOut, Phone, UserRound } from 'lucide-react';
import CurrencyToggle from '@/components/CurrencyToggle';
import LanguageToggle from '@/components/LanguageToggle';
import DeleteAccountButton from '../../DeleteAccountButton';
import { getPortalCustomer } from '@/lib/customerPortal';
import { getCdfRate } from '@/lib/currencyRate';
import { formatPhoneDisplay } from '@/lib/phone';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { logoutAction, deleteAccountAction } from '../../actions';
import { updateProfileNameAction, setWhatsAppAlertsAction } from '../actions';
import { getWhatsAppAlertsOptOut } from '@/lib/customers';
import { ProfileNameForm, WhatsAppAlertsSwitch } from './ProfileSettings';
import { getT, getLocale } from '@/lib/i18n/server';

// generateMetadata, not a static object: a static export is evaluated at
// module load, where there is no request and so no translator.
export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('account.profile.metaTitle'),
    robots: { index: false, follow: false },
  };
}

export const dynamic = 'force-dynamic';

const INSET = 'divide-y divide-line overflow-hidden rounded-card bg-surface shadow-[var(--hairline)]';

function GroupLabel({ children }) {
  return <h2 className="mx-1 mb-1.5 mt-2 text-[0.75rem] font-bold uppercase tracking-[0.08em] text-ink-45">{children}</h2>;
}

function RowIcon({ icon: Icon }) {
  return (
    <span className="grid h-[2.125rem] w-[2.125rem] flex-none place-items-center rounded-[0.625rem] bg-blue-tint text-blue">
      <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
    </span>
  );
}

/**
 * "Mon profil" (2026-10-05 redesign) — grouped inset lists like the agent
 * Réglages: Compte, Notifications, Application, then log out and close.
 *
 * `customers` holds exactly: phone, password hash, full name, and the
 * session/lockout bookkeeping. So there is no e-mail field and no
 * "identité vérifiée" panel — no column behind either. Language is not a
 * column either: it is the NEXT_LOCALE cookie, and the row here is the same
 * LanguageToggle the desktop header carries, so a phone has one too.
 *
 * One contact preference exists because something stores it and acts on it:
 * the WhatsApp alerts switch (`customers.whatsapp_alerts_opted_out_at`, read
 * by the alert sweep). "Mot de passe" goes to the real self-service reset
 * (/mot-de-passe-oublie, WhatsApp OTP).
 */
export default async function ParametresPage() {
  const t = await getT();
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client/parametres');

  const { customer, customerId } = session;
  const [rate, alertsOptedOutAt, locale] = await Promise.all([
    getCdfRate(),
    getWhatsAppAlertsOptOut(customerId).catch(() => null),
    getLocale(),
  ]);
  const alertsOptedOut = Boolean(alertsOptedOutAt);
  const dateTag = locale === 'en' ? 'en-GB' : 'fr-FR';
  const phone = formatPhoneDisplay(customer.phone);
  const name = (customer.full_name || '').trim();
  const initials = name
    ? name.split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('')
    : null;

  const memberSince = customer.created_at
    ? new Intl.DateTimeFormat(dateTag, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(customer.created_at))
    : null;

  return (
    <div className="mx-auto flex max-w-[45rem] flex-col gap-4">
      <h1 className="u-title-page text-ink">{t('account.profile.title')}</h1>

      <div className="flex items-center gap-3 rounded-card bg-surface p-4 shadow-[var(--hairline),var(--shadow-card)]">
        <span className="grid h-14 w-14 flex-none place-items-center rounded-2xl bg-blue-tint text-[1.1875rem] font-extrabold text-blue-deep">
          {initials || <UserRound strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6" aria-hidden="true" />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[1.0625rem] font-bold text-ink">{name || phone}</p>
          {name ? <p className="u-tabular text-[0.8125rem] text-ink-45">{phone}</p> : null}
          {memberSince ? <p className="text-[0.75rem] text-ink-35">{t('account.profile.memberSince', { date: memberSince })}</p> : null}
        </div>
      </div>

      <section>
        <GroupLabel>{t('account.profile.groups.account')}</GroupLabel>
        <div className={INSET}>
          <div className="flex gap-3 px-3.5 py-3.5">
            <RowIcon icon={UserRound} />
            <div className="min-w-0 flex-1">
              <ProfileNameForm initialName={customer.full_name || ''} saveAction={updateProfileNameAction} />
            </div>
          </div>
          {/* Plain text, not a disabled input: a greyed box reads as a field
              that is broken, when it is simply the account's id. */}
          <div className="flex min-h-14 items-center gap-3 px-3.5 py-2">
            <RowIcon icon={Phone} />
            <div className="min-w-0 flex-1">
              <p className="text-[0.90625rem] font-semibold text-ink">{t('account.profile.phone')}</p>
              <p className="u-tabular text-[0.78125rem] text-ink-45">{phone}</p>
              <p className="text-[0.75rem] text-ink-35">{t('account.profile.phoneNote')}</p>
            </div>
          </div>
          <Link href="/mot-de-passe-oublie" className="flex min-h-14 items-center gap-3 px-3.5 py-2 hover:bg-canvas-alt">
            <RowIcon icon={KeyRound} />
            <span className="min-w-0 flex-1">
              <span className="block text-[0.90625rem] font-semibold text-ink">{t('account.profile.password')}</span>
              <span className="block text-[0.78125rem] text-ink-45">{t('account.profile.passwordSub')}</span>
            </span>
            <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 text-ink-35" aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* The account-wide stop for saved-search alerts. Every alert message
          also ends with a link here, so "how do I make it stop" always has an
          answer one tap away. Per-alert frequency lives on the Alertes tab;
          this switch overrides all of them. */}
      <section>
        <GroupLabel>{t('account.profile.groups.notifications')}</GroupLabel>
        <div className={`${INSET} p-4`}>
          <WhatsAppAlertsSwitch initialEnabled={!alertsOptedOut} phoneLabel={phone} setAction={setWhatsAppAlertsAction} />
        </div>
      </section>

      <section>
        <GroupLabel>{t('account.profile.groups.app')}</GroupLabel>
        <div className={INSET}>
          <div className="flex min-h-14 items-center gap-3 px-3.5 py-2">
            <RowIcon icon={Languages} />
            <p className="min-w-0 flex-1 text-[0.90625rem] font-semibold text-ink">{t('account.profile.language')}</p>
            <LanguageToggle />
          </div>
          <div className="flex flex-col gap-3 px-3.5 py-3">
            <div className="flex items-center gap-3">
              <RowIcon icon={Coins} />
              <p className="min-w-0 flex-1 text-[0.90625rem] font-semibold text-ink">{t('common.currency.label')}</p>
            </div>
            <CurrencyToggle longLabels />
            <p className="text-[0.75rem] leading-[1.5] text-ink-45">
              {t('account.profile.currencyNote', {
                rate: Number(rate.cdfPerUsd).toLocaleString(locale === 'en' ? 'en-US' : 'fr-FR'),
                date: rate.updatedAt,
              })}
            </p>
          </div>
        </div>
      </section>

      <div className={INSET}>
        <form action={logoutAction}>
          <button type="submit" className="u-press flex min-h-14 w-full items-center justify-center gap-2 text-[0.9375rem] font-bold text-danger hover:bg-canvas-alt">
            <LogOut strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
            {t('common.actions.logout')}
          </button>
        </form>
      </div>
      <p className="-mt-2 px-1 text-[0.75rem] text-ink-35">{t('account.profile.sessionNote')}</p>

      <section className="mt-2 rounded-card bg-surface p-4 shadow-[var(--hairline)]">
        <h2 className="text-[0.9375rem] font-bold text-ink">{t('account.profile.closeAccount')}</h2>
        <p className="mt-1.5 text-[0.8125rem] leading-[1.55] text-ink-45">{t('account.profile.closeAccountNote')}</p>
        <div className="mt-3">
          <DeleteAccountButton action={deleteAccountAction} />
        </div>
      </section>
    </div>
  );
}
