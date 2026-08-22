import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
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
