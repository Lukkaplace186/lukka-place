import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getPortalCustomer } from '@/lib/customerPortal';
import { getPendingPhoneChange } from '@/lib/customerPhoneChange';
import { formatPhoneDisplay, splitPhone } from '@/lib/phone';
import { getRequestCountry } from '@/lib/requestCountry';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import PhoneChangeForm from './PhoneChangeForm';
import { sendPhoneChangeCodeAction, confirmPhoneChangeAction, cancelPhoneChangeAction } from './actions';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('account.phoneChange.metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

/**
 * "Changer de numéro" (2026-11-08): new number → WhatsApp code to that number
 * → done. Opens on the code step when a change is already waiting (the
 * customer left the page and came back within the code's 10 minutes).
 */
export default async function PhoneChangePage() {
  const t = await getT();
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client/parametres/numero');
  const { customer, customerId } = session;

  const [pending, requestCountry] = await Promise.all([
    getPendingPhoneChange(customerId).catch(() => null),
    getRequestCountry(),
  ]);
  const current = splitPhone(customer.phone);

  return (
    <div className="mx-auto flex max-w-[32rem] flex-col gap-4">
      <Link href="/compte/client/parametres" className="inline-flex items-center gap-1.5 text-[0.875rem] font-semibold text-ink-70 hover:text-ink">
        <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
        {t('account.profile.title')}
      </Link>
      <div>
        <h1 className="u-title-page text-ink">{t('account.phoneChange.title')}</h1>
        <p className="mt-1 text-[0.875rem] text-ink-45">
          {t('account.phoneChange.current', { phone: formatPhoneDisplay(customer.phone) })}
        </p>
      </div>
      <div className="rounded-card bg-surface p-4 shadow-[var(--hairline),var(--shadow-card)] sm:p-5">
        <PhoneChangeForm
          initialStep={pending ? 'code' : 'phone'}
          pendingPhone={pending?.phone || null}
          defaultCountry={current?.country || requestCountry || undefined}
          sendAction={sendPhoneChangeCodeAction}
          confirmAction={confirmPhoneChangeAction}
          cancelAction={cancelPhoneChangeAction}
        />
      </div>
      <p className="px-1 text-[0.75rem] leading-[1.5] text-ink-35">{t('account.phoneChange.footnote')}</p>
    </div>
  );
}
