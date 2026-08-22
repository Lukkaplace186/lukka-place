'use client';

import { useState } from 'react';
import Image from 'next/image';
import { NO_PHOTO_URL } from '@/lib/constants';

/**
 * next/image wrapper that falls back to the site's own placeholder on load
 * failure — some stored image objects genuinely 400 at the Supabase Storage
 * source (confirmed directly against production during QA, unrelated to any
 * app code here), and a visitor should see the same "no photo" placeholder
 * every other photo-less listing already uses, not a broken-image icon.
 */
export default function SafeImage({ src, alt, ...props }) {
  const [failed, setFailed] = useState(false);
  return <Image src={failed ? NO_PHOTO_URL : src} alt={alt} onError={() => setFailed(true)} {...props} />;
}
