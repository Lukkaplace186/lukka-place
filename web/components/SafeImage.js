'use client';

import { useState } from 'react';
import Image from 'next/image';
import { NO_PHOTO_URL } from '@/lib/constants';
import { usableImageSrc } from '@/lib/listingView';

/**
 * next/image wrapper that falls back to the site's own placeholder on load
 * failure — some stored image objects genuinely 400 at the Supabase Storage
 * source (confirmed directly against production during QA, unrelated to any
 * app code here), and a visitor should see the same "no photo" placeholder
 * every other photo-less listing already uses, not a broken-image icon.
 *
 * It also falls back when `src` is unusable in the first place. `onError`
 * only covers an image that was requested and failed; a missing, empty, or
 * non-URL `src` never gets that far. next/image treats those as hard errors
 * — an empty string makes React warn that the browser will re-download the
 * page, and a bare Laravel filename like `default.jpg` throws "Failed to
 * parse src" and takes the whole page down rather than degrading. Both were
 * reachable from real rows: see usableImageSrc() in lib/listingView.js.
 */
export default function SafeImage({ src, alt, ...props }) {
  const [failed, setFailed] = useState(false);
  const resolved = failed || !usableImageSrc(src) ? NO_PHOTO_URL : src;
  return <Image src={resolved} alt={alt} onError={() => setFailed(true)} {...props} />;
}
