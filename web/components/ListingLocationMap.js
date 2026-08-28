'use client';

import ResponsiveMapPane from './ResponsiveMapPane';

/**
 * Single-property map for the detail page — reuses the exact same pipeline
 * as /listings (lib/geocoding.js: real geocode, then commune-centroid
 * fallback, then a deterministic 200-400m privacy jitter seeded by listing
 * id). Nothing here places a pin at an invented coordinate; a listing that
 * resolves to nothing renders the map's own empty state.
 *
 * The privacy note below is not decoration: `properties.latitude` and
 * `longitude` are real columns but NULL on every approved listing, so every
 * pin on this site is a resolved approximation. Saying so is the honest
 * version of what the reference portals label "approximate location".
 *
 * `isMapView` is forced true so ResponsiveMapPane mounts the map on mobile
 * too — its matchMedia gate exists to protect the Geocoding quota on
 * /listings, where a phone visitor may never open the map at all. Here the
 * map is part of the page.
 *
 * The explicit height on `className` below is load-bearing, not
 * decorative: ResponsiveMapPane's own wrapper and PropertyMap's root div
 * are both `h-full`, which resolves to 0 without an ancestor that actually
 * has a height. On /listings that ancestor is ListingsSplitView's
 * `lg:h-[calc(100vh-10rem)]` pane; this page had nothing supplying one at
 * all, so the whole map silently collapsed to zero height — no error, no
 * placeholder, just the caption text below an invisible map. Confirmed by
 * reading the full h-full chain (ListingLocationMap -> ResponsiveMapPane ->
 * PropertyMap), not assumed.
 */
export default function ListingLocationMap({ listing }) {
  return (
    <div>
      <ResponsiveMapPane
        listings={[listing]}
        isMapView
        hoveredId={null}
        onMarkerHover={() => {}}
        maxZoom={15}
        className="h-[22rem] overflow-hidden rounded-lg border border-line sm:h-[26rem]"
      />
      <p className="mt-2.5 text-[0.75rem] text-ink-45">
        Localisation approximative, affichée à l&apos;échelle du quartier pour préserver la confidentialité du bien.
      </p>
    </div>
  );
}
