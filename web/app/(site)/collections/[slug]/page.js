import Link from 'next/link';
import { notFound } from 'next/navigation';
import PropertyCard from '@/components/PropertyCard';
import ShareOnWhatsAppButton from '@/components/ShareOnWhatsAppButton';
import { getT } from '@/lib/i18n/server';
import { SITE_URL } from '@/lib/constants';
import { MIN_COLLECTION, findCollection, getCollectionListings } from '@/lib/browseFeatures';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const collection = findCollection(slug);
  if (!collection) return { robots: { index: false, follow: true } };
  const t = await getT();
  return { title: `${t(collection.titleKey)} — Lukka Place`, alternates: { canonical: `/collections/${slug}` } };
}

/**
 * A themed collection (growth plan item 29): a real search, nationwide, its
 * first 24 listings and a link to the full search. Below MIN_COLLECTION
 * listings it is a 404 rather than a near-empty page.
 */
export default async function CollectionPage({ params }) {
  const { slug } = await params;
  const collection = findCollection(slug);
  if (!collection) notFound();
  const { total, listings } = await getCollectionListings(collection);
  if (total < MIN_COLLECTION) notFound();
  const t = await getT();
  const title = t(collection.titleKey);
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="u-title-hero text-ink">{title}</h1>
      <p className="u-body mt-1 text-ink-70">{t('home.types.count', { count: total })}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={collection.href} className="u-micro-strong inline-flex h-10 items-center rounded-lg px-4 text-blue-deep ring-1 ring-inset ring-line">
          {t('home.collections.seeAll')}
        </Link>
        <ShareOnWhatsAppButton url={`${SITE_URL}/collections/${slug}`} message={`${title} — Lukka Place`} />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {listings.map((listing) => <PropertyCard key={listing.id} listing={listing} />)}
      </div>
    </div>
  );
}
