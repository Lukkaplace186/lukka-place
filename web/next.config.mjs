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
  },
  // Silences a workspace-root inference warning: the sibling package-lock.json
  // in the parent (lukka-place-engine) repo makes Turbopack guess wrong.
  turbopack: {
    root: __dirname,
  },
  images: {
    // Next 16 defaults images.qualities to [75] and silently coerces any
    // other `quality` prop to the nearest allowed value — no error, no
    // warning (confirmed directly against the version-16 upgrade docs and
    // a live q=75 URL after setting quality={90} on CardImageCarousel.js /
    // ListingPhotoCollage.js). 75 stays as the default for every other
    // next/image call site that never set quality explicitly; 90 is what
    // those two components actually ask for.
    qualities: [75, 90],
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
