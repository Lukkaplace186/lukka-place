'use client';

import { useState, useRef, useEffect } from 'react';
import { Monogram } from './Brand';

/**
 * Large hero avatar for the agent storefront (web/app/(site)/agents/[id]/page.js).
 * Same technique as AgencyLogo.js, not SafeImage/next/image — agents.image's
 * real URL convention has never been verified (the one existing row's value
 * is a bare filename, not a full URL), and next/image throws a hard build
 * error for an unconfigured remote domain instead of failing gracefully.
 * Degrades to the real Lukka Place monogram, same fallback AgencyLogo.js
 * already uses — this page's name is already shown as a heading alongside
 * the avatar, so (unlike AgencyLogo) there's no name-as-text fallback step
 * here, straight to the monogram.
 *
 * `onError` alone isn't enough: caught live against the one real row (a bare
 * filename that 404s instantly on localhost) — the native error event fires
 * before React finishes hydrating and attaching the handler, so onError
 * never runs and a broken-image icon shows instead of the fallback. The
 * mount-time `complete && naturalWidth === 0` check below catches exactly
 * that already-failed-before-hydration case; onError stays for a failure
 * that happens after mount (a real network blip, a since-deleted file).
 */
export default function AgentAvatar({ src, alt }) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) {
      setFailed(true);
    }
  }, [src]);

  if (!src || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-canvas-alt">
        <Monogram className="h-8 w-8 text-ink-45" />
      </div>
    );
  }

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}
