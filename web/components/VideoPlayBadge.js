import { Play } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The round play button drawn over a video's cover frame (lib/listingVideos.js),
 * so a video never reads as one more photo. Decoration only: the tile or
 * slide it sits on is what opens the player.
 */
export default function VideoPlayBadge({ size = 'md' }) {
  const box = size === 'sm' ? 'h-10 w-10' : 'h-16 w-16';
  const icon = size === 'sm' ? 'h-4 w-4' : 'h-7 w-7';
  return (
    <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" aria-hidden="true">
      <span className={`flex ${box} items-center justify-center rounded-full bg-ink/60 text-white shadow-lg ring-2 ring-white/80`}>
        <Play strokeWidth={ICON_STROKE_WIDTH} className={`${icon} translate-x-[2px] fill-white`} />
      </span>
    </span>
  );
}
