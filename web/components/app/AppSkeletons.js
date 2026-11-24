import { Skeleton } from '@/components/ui/skeleton';
import AppListingSkeletonPhoto from './AppListingSkeletonPhoto';

/**
 * The app's loading placeholders (2026-11-12): the shapes of its own screens,
 * shown the moment a tab or a listing is tapped, so a slow connection never
 * leaves a blank page or the website's desktop-shaped skeleton. Shapes only,
 * no invented content (the same rule as components/RouteSkeletons.js); they
 * pulse unless the phone asks for reduced motion.
 */

function Status({ label }) {
  return (
    <span role="status" className="sr-only">
      {label}
    </span>
  );
}

function CardShape() {
  return (
    <div className="overflow-hidden rounded-card bg-surface shadow-[var(--shadow-card)]">
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="flex flex-col gap-2 px-4 pb-4 pt-3">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-52 max-w-full" />
        <Skeleton className="h-3.5 w-40" />
      </div>
    </div>
  );
}

/** A tab's screen (home, results, saved): a search box, then listing cards. */
export function AppListSkeleton({ label }) {
  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-6 pt-4">
      <Status label={label} />
      <Skeleton className="h-12 w-full rounded-xl bg-surface" />
      <Skeleton className="mt-5 h-5 w-44" />
      <div className="mt-3 flex flex-col gap-5">
        <CardShape />
        <CardShape />
      </div>
    </div>
  );
}

/** A listing: the photo to the top of the screen, the price, the place, the facts. */
export function AppListingSkeleton({ label }) {
  return (
    // `data-app-listing`: the logo bar steps aside at once, as on the page itself.
    <div className="pb-28" data-app-listing="">
      <Status label={label} />
      {/* The photo the tapped card was showing, when there was one. */}
      <AppListingSkeletonPhoto />
      <div className="flex flex-col gap-3 px-4 pt-5">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-6 w-56 max-w-full" />
        <Skeleton className="h-4 w-44" />
        <div className="mt-1 flex gap-5">
          <Skeleton className="h-5 w-14" />
          <Skeleton className="h-5 w-14" />
          <Skeleton className="h-5 w-16" />
        </div>
        <Skeleton className="mt-4 h-40 w-full rounded-card bg-surface" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
      </div>
    </div>
  );
}
