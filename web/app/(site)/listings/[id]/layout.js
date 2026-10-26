import { notFound } from 'next/navigation';
import { publicListingExists } from '@/lib/listings';

/**
 * Existence check ABOVE this segment's loading.js. The page's own notFound()
 * runs inside that Suspense boundary, after the skeleton has been streamed,
 * so it can only answer 200 + noindex — a soft 404 to search engines, and the
 * dead listings people share are exactly the URLs crawlers keep revisiting.
 * Thrown here, before any boundary, the response is a real 404 rendering
 * ./not-found.js. The page keeps its own check for the rare race where the
 * listing goes offline between the two reads.
 */
export default async function ListingLayout({ children, params }) {
  const { id } = await params;
  if (!(await publicListingExists(id))) notFound();
  return children;
}
