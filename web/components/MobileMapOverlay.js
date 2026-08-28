'use client';

import { useRouter, useSearchParams } from 'next/navigation';

/**
 * The two pieces that float directly over the map CANVAS itself (not the
 * sticky search bar above it — see MobileMapChrome) — a real result-count
 * badge, top-center, and the single "Liste" action that returns to the
 * results list, bottom-center. A sibling of ResponsiveMapPane inside
 * ListingsSplitView's `relative` map-area box, which is why `top-4`/
 * `bottom-6` land relative to the map's own bounds rather than the whole
 * fixed layer (that box, not the sticky bar above it).
 *
 * Numbers are real, not fabricated: `shown` is this page's own result
 * count (what's actually plotted), `totalMatching` is the true count for
 * the active filters (getListings()'s own `total`) — the same "X of Y"
 * semantics a reference portal's own map badge uses.
 *
 * Badge/button chrome uses `.u-lift` (app/globals.css) for elevation, not
 * a bare `shadow-md` class — this app's own `--shadow-md` token isn't
 * registered in the Tailwind `@theme` block, so `shadow-md` here would
 * silently fall back to Tailwind's unrelated built-in shadow instead of
 * the design system's real one. `.u-lift` is the actual registered
 * elevation utility for floating surfaces like this.
 */
export default function MobileMapOverlay({ shown, totalMatching }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function backToList() {
    const qs = new URLSearchParams(searchParams.toString());
    qs.delete('view');
    const s = qs.toString();
    router.push(s ? `/listings?${s}` : '/listings');
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20 lg:hidden">
      {totalMatching != null ? (
        <span className="u-lift u-tabular pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap rounded-xl border border-line bg-surface/95 px-4 py-2 text-[0.75rem] font-semibold text-ink backdrop-blur-md">
          Affichage de {shown} sur {totalMatching.toLocaleString('fr-FR')} bien{totalMatching === 1 ? '' : 's'}
        </span>
      ) : null}

      <button
        type="button"
        onClick={backToList}
        className="u-lift u-press pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-line bg-surface px-6 py-2.5 text-[0.8125rem] font-semibold text-ink"
      >
        Liste
      </button>
    </div>
  );
}
