import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogOut, ShieldCheck } from 'lucide-react';
import CurrencyToggle from '@/components/CurrencyToggle';
import { PortalPanel, PortalSectionHeading } from '@/components/ClientPortalUI';
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

/**
 * "Paramètres" — the design's settings screen, reduced to the fields this
 * schema genuinely has.
 *
 * `customers` holds exactly: phone, password hash, full name, and the
 * session/lockout bookkeeping. So the design's "Adresse e-mail" and
 * "Langue" fields are deliberately absent — there is no column behind
 * either, and a field that silently discards what you typed is worse than
 * no field at all. Its "Identité vérifiée" panel is likewise not
 * reproduced: no ID-verification state exists on this table. What replaces
 * it is the one real security fact — the account is tied to a verified
 * phone number, which is also the only channel a password reset can go
 * through.
 *
 * One contact preference exists now because something stores it and acts on
 * it: the WhatsApp alerts switch (`customers.whatsapp_alerts_opted_out_at`,
 * read by the alert sweep). "Mot de passe oublié" goes to the real
 * self-service reset (/mot-de-passe-oublie, WhatsApp OTP) rather than a
 * pre-typed message to the team.
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

  const memberSince = customer.created_at
    ? new Intl.DateTimeFormat(dateTag, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(customer.created_at))
    : null;

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_21.25rem] lg:items-start">
      <div className="flex flex-col gap-6">
        <PortalSectionHeading title={t('account.profile.title')} lead={t('account.profile.lead')} className="hidden sm:flex" />

        <PortalPanel className="p-6 sm:p-7">
          <h3 className="u-title-card text-ink">{t('account.profile.personalInfo')}</h3>

          <div className="mt-5 flex flex-col gap-5">
            <ProfileNameForm initialName={customer.full_name || ''} saveAction={updateProfileNameAction} />

            {/* Plain text, not a disabled input: a greyed box reads as a
                field that is broken, when it is simply the account's id. */}
            <div>
              <p className="u-eyebrow mb-1.5">{t('account.profile.phone')}</p>
              <p className="u-tabular text-[0.9375rem] font-semibold text-ink">{formatPhoneDisplay(customer.phone)}</p>
              <p className="mt-1 text-[0.75rem] text-ink-35">{t('account.profile.phoneNote')}</p>
            </div>
          </div>

          {memberSince ? (
            <p className="mt-5 border-t border-line pt-4 text-[0.8125rem] text-ink-35">
              {t('account.profile.memberSince', { date: memberSince })}
            </p>
          ) : null}
        </PortalPanel>

        {/* The account-wide stop for saved-search alerts. Every alert message
            also ends with a link here, so "how do I make it stop" always has
            an answer one tap away. Per-alert frequency lives on the Alertes
            tab; this switch overrides all of them. */}
        <PortalPanel className="p-6 sm:p-7">
          <WhatsAppAlertsSwitch
            initialEnabled={!alertsOptedOut}
            phoneLabel={formatPhoneDisplay(customer.phone)}
            setAction={setWhatsAppAlertsAction}
          />
        </PortalPanel>

        <PortalPanel className="p-6 sm:p-7">
          <h3 className="u-title-card text-ink">{t('common.currency.label')}</h3>
          <p className="mt-2 max-w-lg text-[0.8125rem] leading-[1.5] text-ink-45">
            {t('account.profile.currencyNote', {
              rate: Number(rate.cdfPerUsd).toLocaleString(locale === 'en' ? 'en-US' : 'fr-FR'),
              date: rate.updatedAt,
            })}
          </p>
          <div className="mt-4">
            <CurrencyToggle longLabels />
          </div>
        </PortalPanel>
      </div>

      <aside className="flex flex-col gap-5">
        <PortalPanel className="p-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-tint text-blue-deep">
            <ShieldCheck strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="mt-3.5 text-[1.0625rem] font-bold text-ink">{t('account.profile.security')}</h3>
          <p className="mt-2 text-[0.8125rem] leading-[1.55] text-ink-45">
            {t('account.profile.securityNote', { phone: formatPhoneDisplay(customer.phone) })}
          </p>
          <Link
            href="/mot-de-passe-oublie"
            className="mt-3.5 inline-block text-[0.8125rem] font-semibold text-blue-deep hover:underline"
          >
            {t('account.profile.forgotPassword')}
          </Link>
        </PortalPanel>

        <PortalPanel className="p-6">
          <h3 className="text-[1.0625rem] font-bold text-ink">{t('account.profile.session')}</h3>
          <p className="mt-2 text-[0.8125rem] leading-[1.55] text-ink-45">
            {t('account.profile.sessionNote')}
          </p>
          <form action={logoutAction} className="mt-4">
            <button
              type="submit"
              className="u-btn-secondary inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[0.875rem] font-semibold text-ink"
            >
              <LogOut strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
              {t('common.actions.logout')}
            </button>
          </form>
        </PortalPanel>

        <PortalPanel className="p-6">
          <h3 className="text-[1.0625rem] font-bold text-ink">{t('account.profile.closeAccount')}</h3>
          <p className="mt-2 text-[0.8125rem] leading-[1.55] text-ink-45">
            {t('account.profile.closeAccountNote')}
          </p>
          <div className="mt-4">
            <DeleteAccountButton action={deleteAccountAction} />
          </div>
        </PortalPanel>
      </aside>
    </div>
  );
}
