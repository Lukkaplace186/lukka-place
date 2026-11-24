'use client';

import { ViewTransition } from 'react';
import { useParams } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { listingIdOfSegment, listingPhotoTransitionName, recallListingPhoto } from '@/lib/appPhotoHandoff';

/**
 * The photo slot of the app's listing loading screen. When the listing was
 * opened from a card, it shows the very image that card was showing (already
 * downloaded) under the card's view-transition name, so the photo grows from
 * the card into its place while the page loads (lib/appPhotoHandoff.js).
 * Opened any other way (a link, a notification), it is a plain placeholder.
 */
export default function AppListingSkeletonPhoto() {
  const params = useParams();
  const id = listingIdOfSegment(params?.id);
  const src = id ? recallListingPhoto(id) : null;
  const box = 'h-[22rem] w-full overflow-hidden bg-canvas-deep max-sm:-mt-16';

  if (!src) return <Skeleton className={`${box} rounded-none`} />;
  return (
    <ViewTransition name={listingPhotoTransitionName(id)} share="morph" default="none">
      <div className={box}>
        {/* The card's own file, by its exact URL: served from cache, no new download. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="h-full w-full object-cover" />
      </div>
    </ViewTransition>
  );
}
