'use client';

import { useState, useRef, useEffect } from 'react';
import { Monogram } from './Brand';
import { agencyInitials } from '@/lib/agentIdentity';
import { cn } from '@/lib/utils';

/**
 * The one circular agent identity mark used everywhere an agent appears on a
 * public surface: a listing card's agency slot (AgencyLogo.js) and the detail
 * page's EnquiryCard.
 *
 * Three tiers, in order, and each is a true statement about the data:
 *  1. the agent's real uploaded logo (`agents.image`);
 *  2. their initials, when they have a real name but no logo — the common
 *     case by far, measured live: of the 23 currently-approved listings with
 *     an agent attached, 14 belong to agents with a real name and no image;
 *  3. Lukka Place's own Monogram, for a listing with no agent at all, which
 *     genuinely IS handled by the Lukka Place team directly.
 *
 * The initials tier is the reason this exists. Before it, an agent with no
 * uploaded logo got no avatar at all on a card and a digit ("3", the first
 * character of their phone number) on the detail page.
 *
 * Styling follows the monogram on the public /agents/[id] hero — a circle,
 * the display serif, a hairline ring — retuned for a light card surface
 * (blue-tint/blue-deep, the same pair EnquiryCard already used) rather than
 * copied literally: that hero's white-on-ink palette is built for the ink
 * banner it sits in and would be invisible here.
 *
 * Plain <img>, not next/image, for the same reason AgencyLogo.js and
 * AgentAvatar.js use one: `agents.image` holds a full Supabase storage URL on
 * newer rows but a bare filename on older ones, and next/image throws a hard
 * error for an unconfigured remote domain instead of degrading. The
 * mount-time `complete && naturalWidth === 0` check is AgentAvatar.js's
 * fix for the same real bug — a bare filename 404s before React attaches
 * onError, so onError alone leaves a broken-image icon on screen.
 */
export default function AgentMonogram({ logoUrl, name, className = '', textClassName = '' }) {
  // The failed URL, not a boolean: `failed === true` would have to be reset
  // whenever `logoUrl` changes, and an unconditional setState in an effect is
  // exactly the cascading-render pattern react-hooks/set-state-in-effect
  // rejects. Storing which src failed makes the reset fall out of the
  // comparison instead of needing an effect at all.
  const [failedSrc, setFailedSrc] = useState(null);
  const imgRef = useRef(null);
  const failed = failedSrc != null && failedSrc === logoUrl;

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailedSrc(logoUrl);
  }, [logoUrl]);

  const frame = cn(
    'grid shrink-0 place-items-center overflow-hidden rounded-full ring-1 ring-inset ring-line',
    className,
  );

  if (logoUrl && !failed) {
    return (
      <span className={frame}>
        <img
          ref={imgRef}
          src={logoUrl}
          alt={name || ''}
          loading="lazy"
          onError={() => setFailedSrc(logoUrl)}
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

  const initials = agencyInitials(name);
  if (initials) {
    return (
      <span className={cn(frame, 'bg-blue-tint')} aria-hidden="true">
        <span className={cn('font-display leading-none text-blue-deep', textClassName)}>{initials}</span>
      </span>
    );
  }

  return (
    <span className={cn(frame, 'bg-canvas-alt')} aria-hidden="true">
      <Monogram className="h-1/2 w-1/2 text-ink-45" />
    </span>
  );
}
