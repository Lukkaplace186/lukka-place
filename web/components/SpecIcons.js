import { Bed, Bath, Ruler } from 'lucide-react';

/**
 * Icon for a specItems() key (lib/listingView.js). `units` (door count)
 * stays text-only — a door glyph next to "3 portes" is closer to noise than
 * signal, and it's a rarer field than beds/bath/area to begin with.
 */
export const SPEC_ICONS = { beds: Bed, bath: Bath, area: Ruler };
