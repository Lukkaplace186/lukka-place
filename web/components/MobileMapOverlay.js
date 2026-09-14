'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useT } from '@/lib/i18n/client';

/**
 * The single "Liste" action floating over the mobile map canvas, bottom
 * centre, returning to the results list. A sibling of ResponsiveMapPane inside
 * ListingsSplitView's `relative` map-area box, which is why `bottom-6` lands
 * relative to the map's own bounds rather than the whole fixed layer.
 *
 * The result-count badge that used to sit top-centre here ("Affichage de 12
 * sur 46 biens") is gone: it described the list PAGE, which is exactly what
 * the map no longer shows. ListingsMap now renders its own badge — the real
 * count of listings in the visible area — at every breakpoint.
 *
 * Button chrome uses `.u-lift` (app/globals.css) for elevation, not a bare
 * `shadow-md` class — this app's own `--shadow-md` token isn't registered in
 * the Tailwind `@theme` block, so `shadow-md` here would silently fall back to
 * Tailwind's unrelated built-in shadow instead of the design system's real
 * one.
 */
export default function MobileMapOverlay({ hideListButton = false }) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();

  function backToList() {
    const qs = new URLSearchParams(searchParams.toString());
    qs.delete('view');
    const s = qs.toString();
    router.push(s ? `/listings?${s}` : '/listings');
  }

  if (hideListButton) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 lg:hidden">
      <button
        type="button"
        onClick={backToList}
        className="u-lift u-press pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-line bg-surface px-6 py-2.5 text-[0.8125rem] font-semibold text-ink"
      >
        {t('listings.view.list')}
      </button>
    </div>
  );
}
