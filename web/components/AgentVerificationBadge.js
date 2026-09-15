import { BadgeCheck, Building2 } from 'lucide-react';
import { isVerifiedLevel, LEVEL_LABEL_KEYS } from '@/lib/verificationLevels';

/**
 * The green public trust mark: an agent whose identity documents a Lukka Place
 * team member reviewed ("Identité vérifiée"), or an agency whose RCCM was
 * reviewed as well ("Agence partenaire"). Renders nothing for `standard` or an
 * unknown value — never a grey "not verified" stamp on a person, which reads
 * as an accusation rather than the absence of a review.
 *
 * No hooks, so it renders in Server and Client Components alike; the caller
 * hands over its own translator (`getT()` or `useT()`). Keys live in
 * `common`, the one namespace every layout ships.
 *
 * variant="icon"  the check alone, beside a name (label kept for screen readers)
 * variant="pill"  icon + label, for cards and profile headers
 * tone="onDark"   white-on-translucent, for the profile hero photo
 */
export default function AgentVerificationBadge({ level, t, variant = 'pill', tone = 'default', className = '' }) {
  if (!isVerifiedLevel(level)) return null;
  const label = t(LEVEL_LABEL_KEYS[level]);
  const Icon = level === 'agency_partner' ? Building2 : BadgeCheck;

  if (variant === 'icon') {
    return (
      <span className={`inline-flex shrink-0 ${tone === 'onDark' ? 'text-white' : 'text-green-deep'} ${className}`} title={label}>
        <BadgeCheck strokeWidth={2.25} className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  const toneClass = tone === 'onDark' ? 'bg-white/15 text-white ring-1 ring-inset ring-white/30' : 'bg-green-tint text-green-ink';
  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-bold ${toneClass} ${className}`}>
      <Icon strokeWidth={2.25} className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}
