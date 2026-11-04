import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { guestRequestPrefill } from '@/lib/guestRequestRules';
import GuestRequestForm from '@/components/GuestRequestForm';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('listings.guestRequest.metaTitle'),
    description: t('listings.guestRequest.lead'),
    alternates: { canonical: '/trouver-pour-moi' },
  };
}

/**
 * The no-account request on its own page (lib/guestRequestRules.js) — what a
 * customer ad can link to: "Dites-nous ce que vous cherchez", a number, sent.
 * `?transaction_type=&commune=&price_max=&beds_min=&property_type=` prefill
 * it, with the same names as a /listings search, so an ad for "2 chambres à
 * Gombe" can open on that request.
 */
export default async function GuestRequestPage({ searchParams }) {
  const t = await getT();
  const params = await searchParams;
  let communes = [];
  try {
    communes = (await getLocationHierarchyWithFallback()).communes || [];
  } catch (err) {
    console.error(`[trouver-pour-moi] commune list unavailable: ${err.message}`);
  }

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-5 u-lift sm:p-8">
        <h1 className="u-title-section text-ink">{t('listings.guestRequest.title')}</h1>
        <p className="mt-1 mb-5 text-sm text-ink-45">{t('listings.guestRequest.lead')}</p>
        {communes.length > 0 ? (
          <GuestRequestForm communes={communes} prefill={guestRequestPrefill(params, communes)} formId="guest-request-page" />
        ) : (
          <p className="text-sm text-ink-70" role="alert">{t('listings.guestRequest.errors.send')}</p>
        )}
      </div>
    </div>
  );
}
