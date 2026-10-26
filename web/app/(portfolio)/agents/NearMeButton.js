'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LocateFixed } from 'lucide-react';
import { nearestCommunes } from '@/lib/nearestCommunes';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * "Autour de moi" on /agents: one tap asks the phone for its position, picks
 * the nearest communes in the browser (lib/nearestCommunes.js) and opens the
 * directory on them. Only commune names go into the URL — never coordinates.
 * Asked on tap only, never on page load. `centres` are the commune centres
 * the map already uses (lib/geocoding.js COMMUNE_CENTROIDS), passed in by the
 * page so this file ships no location data of its own.
 */
export default function NearMeButton({ centres, keep, labels }) {
  const router = useRouter();
  const [state, setState] = useState({ busy: false, message: null });

  function locate() {
    if (!navigator.geolocation) {
      setState({ busy: false, message: labels.unavailable });
      return;
    }
    setState({ busy: true, message: null });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const communes = nearestCommunes({ lat: position.coords.latitude, lng: position.coords.longitude }, centres);
        if (!communes) {
          setState({ busy: false, message: labels.outside });
          return;
        }
        const query = new URLSearchParams(keep);
        query.set('communes', communes.join(','));
        query.set('pres', '1');
        setState({ busy: false, message: null });
        router.push(`/agents?${query.toString()}`);
      },
      (error) => setState({ busy: false, message: error?.code === 1 ? labels.denied : labels.failed }),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  return (
    // `contents`: the button and its message join the parent row, which
    // wraps, so the message takes a full line instead of squeezing the label.
    <div className="contents">
      <button
        type="button"
        onClick={locate}
        disabled={state.busy}
        className="u-press inline-flex h-9 items-center gap-1.5 self-start rounded-full border border-line bg-white px-3.5 text-[0.8125rem] font-semibold text-ink-70 disabled:opacity-60"
      >
        <LocateFixed className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
        {state.busy ? labels.locating : labels.button}
      </button>
      {state.message ? (
        <p className="w-full text-xs text-ink-70" role="status">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
