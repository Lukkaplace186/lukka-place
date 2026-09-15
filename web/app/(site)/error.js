'use client';

import RouteError from '@/components/RouteError';

/** Public site error boundary — header and footer stay; see components/RouteError.js. */
export default function SiteError({ error, retry }) {
  return <RouteError error={error} retry={retry} scope="site" />;
}
