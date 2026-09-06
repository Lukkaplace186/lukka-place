import { redirect } from 'next/navigation';
import { Send } from 'lucide-react';
import Link from 'next/link';
import Breadcrumb from '@/components/Breadcrumb';
import PropertyCard from '@/components/PropertyCard';
import { getCurrentCustomerId } from '@/lib/customers';
import { getCustomerInquiries } from '@/lib/customerInquiries';
import { LEAD_STATUS_LABEL_KEYS } from '@/lib/adminLabels';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('account.requests.metaTitle'),
    robots: { index: false, follow: false },
  };
}

// No searchParams/cookies() call of its own would trip Next's automatic
// dynamic-rendering detection — same fix already applied on the agent and
// admin dashboards for this exact situation.
export const dynamic = 'force-dynamic';

const DATE_FORMATTER = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : DATE_FORMATTER.format(date);
}

export default async function DemandesPage() {
  const t = await getT();
  const customerId = await getCurrentCustomerId();
  if (!customerId) redirect('/compte/connexion?next=/compte/demandes');

  const inquiries = await getCustomerInquiries(customerId);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <Breadcrumb
        className="mb-6"
        items={[{ label: t('breadcrumb.home'), href: '/' }, { label: t('account.requests.title') }]}
      />

      <header className="mb-10">
        <h1 className="u-title-hero text-ink">
          {t('account.requests.title')}
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-45">
          {t('account.requests.lead')}
        </p>
      </header>

      {inquiries.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface px-6 py-14 text-center">
          <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-canvas-alt text-ink-45">
            <Send strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
          </span>
          <h3 className="u-title-section text-ink">{t('account.requests.emptyTitle')}</h3>
          <p className="mx-auto mt-2 max-w-sm text-[0.875rem] leading-relaxed text-ink-45">
            {t('account.requests.emptyBody')}
          </p>
          <Link
            href="/listings"
            className="mt-7 inline-flex items-center rounded-full bg-blue px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
          >
            {t('account.favorites.browseListings')}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {inquiries.map(({ lead, listing }) => (
            <section key={lead.id} className="rounded-lg border border-line bg-surface p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-[0.8125rem] text-ink-45">Envoyée le {formatDate(lead.created_at)}</p>
                <span className="u-tabular shrink-0 rounded-full bg-canvas-alt px-2.5 py-0.5 text-[0.6875rem] font-semibold text-ink-70">
                  {LEAD_STATUS_LABEL_KEYS[lead.status] ? t(LEAD_STATUS_LABEL_KEYS[lead.status]) : lead.status}
                </span>
              </div>

              {lead.requirements_summary && (
                <p className="mb-4 text-[0.875rem] leading-relaxed text-ink-70">{lead.requirements_summary}</p>
              )}

              {listing ? (
                <div className="max-w-xs">
                  <PropertyCard listing={listing} />
                </div>
              ) : (
                <p className="text-[0.8125rem] italic text-ink-45">{t('account.requests.listingUnavailable')}</p>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
