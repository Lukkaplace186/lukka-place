'use client';

import { useState } from 'react';
import LocaleLink from './LocaleLink';

/**
 * A LocaleLink that prefetches only once the visitor shows intent — mouse
 * over, finger down or keyboard focus — instead of as soon as it is on
 * screen (speed pass, 2026-11-06).
 *
 * For the site chrome (Header, Footer): on /listings the header alone was
 * prefetching ~8 pages (/, /location, /vente, /a-propos, /agents,
 * /compte/connexion, /compte/demandes, /compte/agent/inscription), each in two
 * requests, all competing with the listing photos the visitor was waiting
 * for on a ~0.5 Mbps Kinshasa link. A hover or touch still gives the page a
 * head start of a few hundred milliseconds before the click.
 *
 * `prefetch={false}` alone would also switch off the hover prefetch (Next 16's
 * Link returns early on it), hence the state: false until intent, then the
 * default. The Next docs' own "HoverPrefetchLink" pattern.
 */
export default function IntentLink({ onMouseEnter, onTouchStart, onFocus, prefetch, ...props }) {
  const [active, setActive] = useState(false);
  const wake = () => { if (!active) setActive(true); };
  return (
    <LocaleLink
      {...props}
      prefetch={prefetch === false ? false : active ? (prefetch ?? null) : false}
      onMouseEnter={(e) => { wake(); onMouseEnter?.(e); }}
      onTouchStart={(e) => { wake(); onTouchStart?.(e); }}
      onFocus={(e) => { wake(); onFocus?.(e); }}
    />
  );
}
