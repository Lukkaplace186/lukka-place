import { cn } from '@/lib/utils';

/**
 * Route-level loading placeholders for the public site, the listing detail
 * page and the agent dashboard (their `loading.js` files).
 *
 * Every one of those routes is rendered on demand from Postgres and the
 * engine. Without a loading boundary, a tap on a listing card over 3G left
 * the previous page on screen, inert, for as long as the server took — which
 * reads as a dead tap, so people tap again. A loading.js also gives Next
 * something to prefetch for a dynamic route, so the skeleton itself appears
 * on the tap rather than after a round trip.
 *
 * Shapes only, no invented content — same rule as components/PortalSkeleton.js.
 * `motion-safe:` so a reduced-motion visitor gets still blocks.
 */

function Block({ className }) {
  return <div aria-hidden="true" className={cn('rounded-md bg-canvas-deep motion-safe:animate-pulse', className)} />;
}

function Status({ label }) {
  return (
    <span role="status" className="sr-only">
      {label}
    </span>
  );
}

function CardShape() {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <Block className="aspect-[16/10] w-full rounded-none" />
      <div className="flex flex-col gap-2.5 p-4">
        <Block className="h-6 w-32" />
        <Block className="h-4 w-48" />
        <Block className="h-4 w-40" />
        <div className="mt-2 flex gap-2 border-t border-line pt-3">
          <Block className="h-11 flex-1 rounded-full" />
          <Block className="h-11 flex-1 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/** Any public page without a more specific skeleton: a heading and a card grid. */
export function SitePageSkeleton({ label }) {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <Status label={label} />
      <Block className="h-8 w-64 max-w-full" />
      <Block className="mt-3 h-4 w-40" />
      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <CardShape key={i} />
        ))}
      </div>
    </div>
  );
}

/** /listings/[id]: gallery, price, key facts, enquiry card. */
export function ListingDetailSkeleton({ label }) {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pb-24 pt-4 sm:px-6 sm:pt-6 lg:px-8">
      <Status label={label} />
      <Block className="h-4 w-48" />
      <Block className="mt-4 h-[22rem] w-full rounded-xl sm:h-[28rem]" />
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-3">
          <Block className="h-9 w-44" />
          <Block className="h-5 w-72 max-w-full" />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Block key={i} className="h-16 rounded-lg" />
            ))}
          </div>
          <Block className="mt-4 h-4 w-full" />
          <Block className="h-4 w-11/12" />
          <Block className="h-4 w-4/5" />
        </div>
        <div className="hidden flex-col gap-3 rounded-card border border-line bg-surface p-6 lg:flex">
          <Block className="h-12 w-12 rounded-full" />
          <Block className="h-5 w-40" />
          <Block className="h-11 w-full rounded-full" />
          <Block className="h-11 w-full rounded-full" />
        </div>
      </div>
    </div>
  );
}

/** /compte/agent/*: page header, stat tiles, a list. The sidebar stays (it lives in the layout). */
export function AgentDashboardSkeleton({ label }) {
  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
      <Status label={label} />
      <div className="flex flex-col gap-2">
        <Block className="h-8 w-56" />
        <Block className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Block key={i} className="h-24 rounded-card" />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-4 rounded-card bg-surface p-4">
            <Block className="h-16 w-20 shrink-0 rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Block className="h-4 w-40" />
              <Block className="h-4 w-28" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
