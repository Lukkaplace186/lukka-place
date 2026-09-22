'use client';

import { usePathname } from 'next/navigation';

/**
 * Picks between two server-rendered footers by path. Footer is a Server
 * Component with no request pathname, so the decision is made here, on the
 * client, over two trees that were both already rendered on the server.
 *
 * `prefixes` get `compact`; everything else gets `children` (the full site
 * footer). Matching is by path segment, so '/compte/client' covers its tabs
 * but not an unrelated '/compte/clientele'.
 */
export default function FooterByPath({ prefixes, compact, children }) {
  const pathname = usePathname() || '';
  const matched = prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return matched ? compact : children;
}
