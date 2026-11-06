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
 *
 * `hiddenUnder` renders no footer at all on the pages strictly BELOW a
 * prefix: '/messages' hides it on a conversation (/messages/12), which fills
 * the screen with its own composer at the bottom, and keeps it on the inbox.
 */
export default function FooterByPath({ prefixes, hiddenUnder = [], compact, children }) {
  const pathname = usePathname() || '';
  if (hiddenUnder.some((prefix) => pathname.startsWith(`${prefix}/`))) return null;
  const matched = prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return matched ? compact : children;
}
