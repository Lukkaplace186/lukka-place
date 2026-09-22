import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_ACTION_BODY_SIZE_LIMIT_BYTES } from './lib/uploadLimits.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Next.js caps a Server Action request body at 1 MB when this is unset,
    // and it was unset — which is what broke every manual listing
    // submission from the agent dashboard while WhatsApp intake (a plain
    // Express route on the engine, no Server Action involved) kept working.
    // A phone photo is routinely 2-5 MB, so the request was aborted with a
    // 413 before the action ran at all; the agent got a rejected fetch, not
    // an `{ ok: false }`, and therefore no message. Production
    // pm2-error.log has the receipts ("Body exceeded 1 MB limit.").
    //
    // The number is DERIVED from the app's own photo budget rather than
    // typed here, so the transport ceiling and what the UI promises cannot
    // drift apart again — that drift was the entire bug. See
    // lib/uploadLimits.mjs, and tests/unit/upload-limits.test.js, which
    // pins this config against it.
    serverActions: {
      bodySizeLimit: SERVER_ACTION_BODY_SIZE_LIMIT_BYTES,
    },
    // Keep a page the visitor just saw in the in-memory router cache for 30s
    // (Next 15+ defaults this to 0). Every route here is dynamic (the locale
    // cookie), so without it going Vue → Demandes → Vue on the agent tab bar
    // re-rendered the overview on the server each time, over 3G. Actions still
    // invalidate it: revalidatePath and router.refresh drop the cached entry,
    // so an answer the agent just gave is never shown stale. Browser memory
    // only — nothing is cached on disk or in the service worker (which still
    // never caches HTML).
    staleTimes: {
      dynamic: 30,
    },
  },
  // Silences a workspace-root inference warning: the sibling package-lock.json
  // in the parent (lukka-place-engine) repo makes Turbopack guess wrong.
  turbopack: {
    root: __dirname,
  },
  // Response compression. Next gzips by default, and nothing in front of it
  // speaks brotli, which is ~15-20% smaller on the JS our visitors pay for by
  // the megabyte. The plan is for Traefik's `compress` middleware (br + gzip)
  // to do it instead — but Traefik skips a response that already carries a
  // Content-Encoding, so Next's own gzip has to be switched off at the same
  // moment. WEB_COMPRESS=off (read when the server starts) is that switch,
  // and it must only be set once the Traefik middleware is live: set without
  // it, every page ships uncompressed.
  compress: process.env.WEB_COMPRESS !== 'off',
  async headers() {
    return [
      {
        // The service worker must never be served from an HTTP cache, or a
        // fix to it (including its kill switch) cannot reach anyone.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
    ];
  },
  images: {
    // Next 16 defaults images.qualities to [75] and silently coerces any
    // other `quality` prop to the nearest allowed value. Everything uses 75
    // now: the two card components that asked for 90 roughly doubled every
    // grid photo on mobile data (64 KB at w=640 q=90 vs 34 KB at w=750 q=75,
    // same photo, measured on production) for no difference visible on a
    // phone, and made the detail page fetch a card's cover photo twice.
    qualities: [75],
    // Listing photos are content-addressed in Supabase Storage (the object
    // name carries an md5 of the bytes — lib/listingStorage.js and the
    // engine's services/supabaseStorage.js), so an optimised variant never
    // goes stale. The 4h default made returning visitors revalidate and
    // re-download photos they already had.
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns: [
      {
        // Supabase Storage — listing photos (featured_image, property_slider_images).
        // See lukka-place-engine/services/supabaseStorage.js for the upload side.
        protocol: 'https',
        hostname: 'havyrzfdksabghgbrxfy.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
      {
        // The site's own placeholder for listings with no photos yet
        // (services/postgres.js's NO_PHOTO_URL).
        protocol: 'https',
        hostname: 'lukkaplace.com',
        port: '',
        pathname: '/assets/img/**',
      },
    ],
  },
};

export default nextConfig;
