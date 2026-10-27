'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Volume2, VolumeX } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The /videos feed: one listing video per screen, scroll-snapped, the one in
 * view playing muted and looping, the others paused (visitors pay per MB, so
 * nothing loads before it is near: `preload="none"` with the cover frame).
 * Sound is one tap, for the whole feed.
 */
export default function VideoFeed({ items, labels }) {
  const containerRef = useRef(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return undefined;
    const videos = [...root.querySelectorAll('video')];
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const video = entry.target;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      }
    }, { root, threshold: [0, 0.6] });
    videos.forEach((video) => observer.observe(video));
    return () => observer.disconnect();
  }, [items]);

  useEffect(() => {
    containerRef.current?.querySelectorAll('video').forEach((video) => { video.muted = muted; });
  }, [muted]);

  return (
    <div className="relative bg-ink">
      <h1 className="sr-only">{labels.title}</h1>
      <div ref={containerRef} className="h-[calc(100dvh-4rem)] snap-y snap-mandatory overflow-y-auto">
        {items.map((item) => (
          <section key={item.id} className="relative flex h-[calc(100dvh-4rem)] snap-start items-center justify-center">
            <video
              src={item.src}
              poster={item.poster || undefined}
              preload={item.poster ? 'none' : 'metadata'}
              muted
              loop
              playsInline
              className="h-full w-full max-w-[34rem] object-contain"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 pb-8 text-white">
              <div className="mx-auto max-w-[34rem]">
                {item.price ? <p className="u-tabular text-lg font-bold">{item.price}</p> : null}
                {item.place ? <p className="text-sm text-white/85">{item.place}</p> : null}
                <Link href={`/listings/${item.id}`} className="u-press mt-3 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-bold text-ink">
                  {labels.open}
                </Link>
              </div>
            </div>
          </section>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setMuted((value) => !value)}
        aria-label={labels.sound}
        aria-pressed={!muted}
        className="u-hit absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white"
      >
        {muted ? <VolumeX strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" /> : <Volume2 strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />}
      </button>
    </div>
  );
}
