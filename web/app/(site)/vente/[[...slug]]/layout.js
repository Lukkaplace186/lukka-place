import { notFound } from 'next/navigation';
import { parseSeoSegments } from '@/lib/seoPages';

/**
 * An unknown /vente/… path is a real 404: checked here, above this
 * segment's loading.js, because a notFound() in the page runs after the
 * skeleton has streamed and can only answer 200 + noindex (see
 * app/(site)/_shared/SiteLoading.js). Pure — no database read.
 */
export default async function VenteLandingLayout({ children, params }) {
  const { slug } = await params;
  if (!parseSeoSegments('vente', slug || [])) notFound();
  return children;
}
