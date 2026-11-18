'use client';

import { usePathname } from 'next/navigation';
import { isListingPagePath } from '@/lib/listingPagePath';

/** Renders its children everywhere except on a listing's own page. */
export default function HideOnListingPage({ children }) {
  return isListingPagePath(usePathname()) ? null : children;
}
