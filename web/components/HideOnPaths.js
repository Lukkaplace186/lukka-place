'use client';

import { usePathname } from 'next/navigation';

/**
 * Renders its (server-rendered) children except under the given path
 * prefixes. Lets a Server Component like Footer drop one block on a few
 * routes without every page needing to know it exists.
 */
export default function HideOnPaths({ prefixes, children }) {
  const pathname = usePathname() || '';
  if (prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null;
  return children;
}
