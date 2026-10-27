import Link from 'next/link';
import PropertyCard from '@/components/PropertyCard';
import ShareOnWhatsAppButton from '@/components/ShareOnWhatsAppButton';
import { getT } from '@/lib/i18n/server';
import { SITE_URL } from '@/lib/constants';
import { getListingOfTheDay } from '@/lib/browseFeatures';

export const dynamic = 'force-dynamic';

/**
 * "Bien du jour" (growth plan item 27): one live listing a day, the team's
 * pick or a fixed draw (lib/browseFeatures.js). A shareable address that
 * changes every day; the link preview is the listing's own card, drawn by
 * ./opengraph-image.js. The 4:5 post for social media is the
 * team's "Carte réseaux sociaux" on /admin/listings/<id>.
 */
export async function generateMetadata() {
  const t = await getT();
  // The preview image is ./opengraph-image.js (today's listing card).
  return {
    title: `${t('home.daily.title')} — Lukka Place`,
    description: t('home.daily.lead'),
    alternates: { canonical: '/bien-du-jour' },
  };
}

export default async function ListingOfTheDayPage() {
  const t = await getT();
  const daily = await getListingOfTheDay();
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-8">
      <div>
        <p className="u-eyebrow text-blue-deep">{t('home.daily.eyebrow')}</p>
        <h1 className="u-title-hero mt-1 text-ink">{t('home.daily.title')}</h1>
        <p className="u-body mt-2 text-ink-70">{t('home.daily.lead')}</p>
      </div>
      {daily ? (
        <>
          <PropertyCard listing={daily.listing} />
          <div className="flex flex-wrap gap-2">
            <Link href={`/listings/${daily.listing.id}`} className="u-btn-primary u-press inline-flex h-11 items-center rounded-lg bg-blue px-5 text-sm font-bold text-white">
              {t('home.daily.open')}
            </Link>
            <ShareOnWhatsAppButton url={`${SITE_URL}/bien-du-jour`} />
          </div>
        </>
      ) : (
        <p className="u-body text-ink-70">{t('home.daily.none')}</p>
      )}
    </div>
  );
}
