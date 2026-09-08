import { adminListCustomers } from '@/lib/customers';
import { adminSetCustomerPasswordAction } from './actions';
import PasswordResetForm from '../PasswordResetForm';
import { getT } from '@/lib/i18n/server';

/**
 * The console had no customer surface at all — agents had a full detail page
 * and customers had nothing, so a customer locked out of their account (or
 * stuck behind an OTP that never arrives) could not be helped by anyone.
 *
 * Deliberately a list with an inline reset rather than a second detail page:
 * password reset is the only customer-account operation this console has any
 * business performing today, and a per-customer page whose only control was
 * this form would be a click in the way of it. Everything a customer owns
 * that an admin might want to see — their enquiries, their viewing requests —
 * already lives on /admin/leads and /admin/conversations, keyed by phone.
 */
function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export default async function AdminCustomersPage({ searchParams }) {
  const t = await getT();
  const params = await searchParams;
  const q = params?.q || '';

  const customers = await adminListCustomers({ q: q || undefined });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.customers.title')}</h1>
          <p className="mt-1 text-sm text-ink-45">
            {customers.length} {customers.length === 1 ? t('admin.customers.one') : t('admin.customers.many')}
          </p>
        </div>

        <form method="get" className="flex items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={t('admin.customers.searchPlaceholder')}
            className="rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink"
          />
          <button
            type="submit"
            className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas-alt"
          >
            {t('admin.customers.search')}
          </button>
        </form>
      </div>

      {customers.length === 0 ? (
        <p className="u-card rounded-card bg-surface p-6 text-sm text-ink-45">{t('admin.customers.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {customers.map((customer) => (
            <li key={customer.id} className="u-card rounded-card bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="u-title-card truncate text-ink">
                    {customer.full_name || t('admin.customers.noName')}
                  </h2>
                  <p className="u-micro mt-1 text-ink-45">
                    +{customer.phone} · #{customer.id}
                    {formatDate(customer.created_at) ? ` · ${t('admin.customers.since')} ${formatDate(customer.created_at)}` : ''}
                  </p>
                </div>

                {/* Every one of these is a real column, not a derived guess —
                    they are the four things that decide whether a "I can't
                    log in" report is a forgotten password, an unverified
                    number, a lockout, or an account with no password at all. */}
                <dl className="u-micro grid shrink-0 grid-cols-2 gap-x-5 gap-y-1 text-ink-70">
                  <dt className="text-ink-45">{t('admin.customers.hasPassword')}</dt>
                  <dd className="font-bold">{customer.has_password ? t('common.states.yes') : t('common.states.no')}</dd>
                  <dt className="text-ink-45">{t('admin.customers.verified')}</dt>
                  <dd className="font-bold">{customer.phone_verified_at ? t('common.states.yes') : t('common.states.no')}</dd>
                  <dt className="text-ink-45">{t('admin.customers.failedLogins')}</dt>
                  <dd className="font-bold">{customer.failed_login_count ?? 0}</dd>
                  <dt className="text-ink-45">{t('admin.customers.locked')}</dt>
                  <dd className="font-bold">{customer.locked_until ? t('common.states.yes') : t('common.states.no')}</dd>
                </dl>
              </div>

              <details className="mt-4 border-t border-line pt-4">
                <summary className="u-micro-strong cursor-pointer text-blue-deep">
                  {t('admin.password.title')}
                </summary>
                <div className="mt-3">
                  <PasswordResetForm
                    action={adminSetCustomerPasswordAction.bind(null, customer.id)}
                    accountLabel={`+${customer.phone}`}
                    compact
                  />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
