import Link from '@/components/LocaleLink';
import PropertyCard from '@/components/PropertyCard';
import { getListings } from '@/lib/listings';
import { cityOfCommune } from '@/lib/cities';
import { postListingsHref } from '@/lib/blogRules';

/**
 * `:::annonces` on the public article: three live listings under the public
 * gate (getListings). Passed to ArticleBody by app/(site)/guides/[slug] as
 * `listingsBlock`, so the console's preview never imports the storefront
 * cards (their client namespaces are not provided under /admin); there the
 * block is named instead.
 */
export default async function LiveListings({ block, t }) {
  const href = postListingsHref({ purpose: block.transaction, commune: block.commune, property_type: block.propertyType });
  let listings = [];
  try {
    const { data } = await getListings({
      transactionType: block.transaction,
      commune: block.commune || undefined,
      propertyType: block.propertyType || undefined,
      ville: block.commune ? cityOfCommune(block.commune) : undefined,
      limit: 3,
      sort: 'complete',
    });
    listings = data || [];
  } catch (err) {
    console.error(`[guides] :::annonces unavailable: ${err.message}`);
  }
  if (!listings.length) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {listings.map((listing) => (
          <PropertyCard key={listing.id} listing={listing} />
        ))}
      </div>
      {href ? (
        <Link href={href} className="u-micro-strong self-start text-blue-deep hover:underline">
          {t('guides.seeListings')} →
        </Link>
      ) : null}
    </div>
  );
}
