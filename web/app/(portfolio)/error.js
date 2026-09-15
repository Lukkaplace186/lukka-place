'use client';

import RouteError from '@/components/RouteError';

/** Agent portfolio (/agents) error boundary; see components/RouteError.js. */
export default function PortfolioError({ error, retry }) {
  return <RouteError error={error} retry={retry} scope="portfolio" />;
}
