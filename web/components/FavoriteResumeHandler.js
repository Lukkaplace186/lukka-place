'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isFavorite, toggleFavorite } from '@/lib/favorites';
import { useIsLoggedIn } from '@/lib/customerClient';

const FAV_RETURN_PARAM = 'lkp_fav_return';

/**
 * Mounted once in app/(site)/layout.js, not inside FavoriteButton.js itself.
 *
 * FavoriteButton renders many times on one page (a whole listings grid, or
 * several instances for the *same* listing on the detail page — the top
 * action row, EnquiryCard, MobileListingBar all render their own). If each
 * instance ran its own "resume the pending favorite" effect keyed off the
 * same listingId, landing back from signup with several of them mounted for
 * that id would fire the real toggleFavorite() more than once and cancel
 * itself back out (add, then immediately remove). One handler, mounted
 * exactly once regardless of how many hearts are on the page, removes that
 * race entirely.
 *
 * Reads `window.location.search` directly in the effect rather than
 * `useSearchParams()` — this component sits at the layout root, present on
 * every public page, and useSearchParams() forces a Suspense boundary around
 * its caller (see web/CLAUDE.md's documented gotcha); wrapping the entire
 * site shell in Suspense for one query param is exactly what that gotcha
 * warns against. Same pattern favoris/page.js's SharedListSection already
 * uses for the same reason.
 */
export default function FavoriteResumeHandler() {
  const pathname = usePathname();
  const router = useRouter();
  const loggedIn = useIsLoggedIn();
  const resumedRef = useRef(false);

  useEffect(() => {
    if (resumedRef.current) return;
    if (!loggedIn) return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get(FAV_RETURN_PARAM);
    if (!id) return;
    resumedRef.current = true;

    if (!isFavorite(id)) toggleFavorite(id);

    params.delete(FAV_RETURN_PARAM);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [loggedIn, pathname, router]);

  return null;
}

export { FAV_RETURN_PARAM };
