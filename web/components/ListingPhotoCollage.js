'use client';

import { motion } from 'framer-motion';
import SafeImage from './SafeImage';
import { imageZoom } from '@/lib/motion';
import { useMotionSafe } from '@/lib/useMotionSafe';

/**
 * Rightmove-style photo collage: one large frame plus two stacked smaller
 * ones. Real listings here carry anywhere from 0 to 16 photos, and until now
 * a result card showed exactly one of them — the collage is the single
 * highest-signal upgrade available from data already fetched on every read
 * (GALLERY_SUBQUERY in lib/listings.js).
 *
 * Degrades honestly: 3+ photos gets the full collage, 2 gets a split, 1 or 0
 * gets a single frame (SafeImage falls back to the real "no photo"
 * placeholder). No frame is ever padded with a repeated image to fake a
 * fuller gallery.
 */
function Frame({ src, alt, sizes, zoom, className }) {
  return (
    <div className={`relative overflow-hidden bg-canvas-alt ${className}`}>
      <motion.div variants={zoom} className="absolute inset-0">
        <SafeImage
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          quality={90}
          className="object-cover contrast-[1.03] brightness-[1.02] saturate-[1.04]"
        />
      </motion.div>
    </div>
  );
}

export default function ListingPhotoCollage({ images, alt, sizes = '(min-width: 1024px) 22rem, 100vw' }) {
  const safe = useMotionSafe();
  const zoom = safe ? imageZoom : undefined;
  const shots = images && images.length ? images : [null];
  const shared = { alt, sizes, zoom };

  if (shots.length >= 3) {
    return (
      <div className="grid h-full w-full grid-cols-[2fr_1fr] grid-rows-2 gap-[2px]">
        <Frame {...shared} src={shots[0]} className="row-span-2" />
        <Frame {...shared} src={shots[1]} className="" />
        <Frame {...shared} src={shots[2]} className="" />
      </div>
    );
  }

  if (shots.length === 2) {
    return (
      <div className="grid h-full w-full grid-cols-[2fr_1fr] gap-[2px]">
        <Frame {...shared} src={shots[0]} className="" />
        <Frame {...shared} src={shots[1]} className="" />
      </div>
    );
  }

  return <Frame {...shared} src={shots[0]} className="h-full w-full" />;
}
