import { cn } from '@/lib/utils';

/**
 * Loading placeholders for the Espace Client tabs (the `loading.js` files
 * under app/(site)/compte/client, and the Suspense fallbacks inside them).
 *
 * Every portal page is rendered on demand from the database and the engine,
 * and before these existed a tab tap left the previous tab on screen, inert,
 * until the whole new page had been computed — which reads as a dead button.
 * The tab bar lives in the layout and stays put; only the body below it is
 * replaced.
 *
 * Shapes only, no invented content. `motion-safe:` so a reduced-motion
 * visitor gets still blocks rather than a pulse.
 */

function Block({ className }) {
  return <div aria-hidden="true" className={cn('rounded-md bg-canvas-deep motion-safe:animate-pulse', className)} />;
}

function Panel({ className, children }) {
  return <div className={cn('u-card rounded-card bg-surface', className)}>{children}</div>;
}

function Status({ label }) {
  return (
    <span role="status" className="sr-only">
      {label}
    </span>
  );
}

/** Favoris & Alertes: a heading and a grid of cards. */
export function PortalBoardSkeleton({ label }) {
  return (
    <div>
      <Status label={label} />
      <Block className="h-8 w-56" />
      <Block className="mt-3 h-4 w-80 max-w-full" />
      <div className="mt-7 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Panel key={i} className="overflow-hidden">
            <Block className="h-[13.125rem] rounded-none" />
            <div className="flex flex-col gap-3 p-5">
              <Block className="h-6 w-32" />
              <Block className="h-4 w-48" />
              <Block className="mt-3 h-10 w-full rounded-full" />
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

/** Messages & Visites: the two-pane inbox. */
export function PortalInboxSkeleton({ label }) {
  return (
    <div>
      <Status label={label} />
      <Block className="h-8 w-64" />
      <Block className="mt-3 h-4 w-72 max-w-full" />
      <Panel className="mt-7 grid grid-cols-1 overflow-hidden lg:min-h-[36rem] lg:grid-cols-[22.5rem_minmax(0,1fr)]">
        <div className="flex flex-col border-b border-line lg:border-b-0 lg:border-r">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3.5 border-b border-line px-5 py-4">
              <Block className="h-[3.25rem] w-[3.25rem] shrink-0" />
              <div className="flex flex-1 flex-col gap-2">
                <Block className="h-4 w-3/4" />
                <Block className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden flex-col gap-4 bg-canvas-alt p-6 lg:flex">
          <Block className="h-24 w-full" />
          <Block className="h-40 w-full" />
        </div>
      </Panel>
    </div>
  );
}

/** Trouver pour moi / Profil: a form panel beside a narrow column. */
export function PortalFormSkeleton({ label }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_23.75rem] lg:items-start">
      <Status label={label} />
      <Panel className="flex flex-col gap-5 p-6 sm:p-8">
        <Block className="h-8 w-60" />
        <Block className="h-4 w-full max-w-md" />
        {[0, 1, 2].map((i) => (
          <Block key={i} className="h-24 w-full" />
        ))}
      </Panel>
      <div className="flex flex-col gap-5">
        <Block className="h-32 w-full" />
        <Block className="h-32 w-full" />
      </div>
    </div>
  );
}
