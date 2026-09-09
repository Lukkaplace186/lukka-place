'use client';

import { useState } from 'react';
import AgentMonogram from './AgentMonogram';
import { displayableAgencyName } from '@/lib/agentIdentity';
import { useT } from '@/lib/i18n/client';

/**
 * Right-aligned agency identity slot for a listing card's header — real
 * `agents.image`/`agents.username` (via `properties.agent_id`), when a
 * listing actually has one attached. Both are `null` on every listing
 * today (see WhatsAppCTA.js's doc comment on `resolveAgentId`).
 *
 * Falls back to Lukka Place's own real wordmark (`/brand/logo-light.png` —
 * the client-supplied brand mark, see Brand.js's `Wordmark`, same file the
 * site header uses) rather than nothing: every listing without an
 * attributed agent genuinely IS handled directly by Lukka Place's own team
 * (the whole "Une seule équipe, un seul numéro" architecture), so showing
 * the platform's real mark is an honest signal of who's actually
 * responsible, not an invented placeholder standing in for a fictional
 * agency. Tried the isolated icon-square-512.png roofline mark here first,
 * but at card scale it's too abstract to read as "Lukka Place" — the full
 * wordmark is what's actually recognisable, so it gets the same wide
 * `max-h-10 w-auto` frame a real per-agent logo would use below, rather
 * than a separate small-icon treatment. `logo-light.png` specifically
 * (not `logo-dark.png`) because this slot sits on the card's white
 * surface — the colored variant is the one built for a light background.
 *
 * Plain `<img>` for the real per-agent case, not `next/image`:
 * `agents.image`'s real URL convention has never been verified (the one
 * existing test row holds a bare filename, not a full URL), and
 * `next/image` throws a hard error for an unconfigured remote domain
 * instead of failing gracefully — exactly the wrong failure mode for a
 * field whose real shape is still unknown. A load failure (wrong domain,
 * 404, bare filename) falls back to the agency name as text, then to the
 * Lukka Place mark, same as the no-agent case.
 *
 * Every branch now leads with a real circular mark (AgentMonogram), not just
 * the ones that happen to have an uploaded image: an agent with a name and no
 * logo gets their initials, and only a listing with no agent at all falls
 * through to the Lukka Place mark. That was the gap — most agents have no
 * uploaded logo (14 of the 23 currently-approved attributed listings), so the
 * name-only branch below was the *common* rendering, and it left the agency
 * slot as a bare line of text with nothing to anchor it.
 *
 * `name` is passed through `displayableAgencyName` first. lib/listings.js's
 * AGENCY_NAME_EXPR already resolves a phone-shaped `agents.username` to NULL
 * in SQL, but this component is also reachable from queries that select
 * `a.username` raw, and printing a phone number where an agency name belongs
 * is the exact bug this pair of changes fixes — worth refusing in both places.
 *
 * `variant="footer"` is a round-avatar + name row for a card's footer — the
 * same avatar+label pair as the default variant, just at 32px and without
 * the width ceiling on the label, to read as "agent identity" alongside the
 * footer's contact buttons rather than a stray logo floating in the metadata
 * block. It renders unconditionally (the caller decides whether the slot
 * belongs at all), so its no-agent case is the Lukka Place monogram + name
 * rather than nothing; at true avatar scale the roofline mark reads fine,
 * unlike the wide horizontal slot the default variant's doc comment above
 * found it too abstract for.
 */
export default function AgencyLogo({ logoUrl, name, variant = 'default' }) {
  const t = useT();
  const [failed, setFailed] = useState(false);

  const agencyName = displayableAgencyName(name);
  const label = agencyName || t('footer.columns.brand');

  if (variant === 'footer') {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <AgentMonogram logoUrl={logoUrl} name={agencyName} className="h-8 w-8 text-[0.8125rem]" />
        <span className="truncate text-[0.8125rem] font-semibold text-ink-70">{label}</span>
      </div>
    );
  }

  // Default variant: the agency slot on a card's title row. It shares that
  // row with a `truncate`d location line, which is what gives the mark its
  // width without wrapping — see PropertyCard.js's note on why this badge
  // lives here and not on the spec rail below.
  if (agencyName) {
    return (
      <span className="flex shrink-0 items-center gap-1.5">
        <AgentMonogram logoUrl={logoUrl} name={agencyName} className="h-6 w-6 text-[0.625rem]" />
        <span className="max-w-[7.5rem] truncate text-[0.8125rem] font-semibold leading-tight text-ink-70">
          {agencyName}
        </span>
      </span>
    );
  }

  // No agent attached (or a logo-only row whose image is still loading fine):
  // a real per-agent logo still gets its own wide frame, since a logo without
  // a name is the one case where the image alone carries the identity.
  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt={t('footer.columns.brand')}
        loading="lazy"
        onError={() => setFailed(true)}
        className="max-h-10 w-auto shrink-0 object-contain"
      />
    );
  }

  return (
    <img
      src="/brand/logo-light.png"
      alt={t('footer.columns.brand')}
      width={2354}
      height={746}
      className="h-5 w-auto shrink-0 object-contain"
    />
  );
}
