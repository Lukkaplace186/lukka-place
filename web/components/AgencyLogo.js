'use client';

import { useState } from 'react';
import { Monogram } from './Brand';

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
 * `variant="footer"` is a round-avatar + name row for a card's footer
 * (ListingCardVertical.js, ListingCard.js) — same real-logo -> name-only ->
 * Lukka Place fallback priority as the default variant above, just laid out
 * as an avatar+label pair instead of a bare logo image, to read as "agent
 * identity" alongside the footer's contact buttons rather than a stray
 * logo floating in the metadata block. The Lukka Place fallback uses the
 * real `Monogram` (Brand.js) — at true avatar scale (32px) the roofline
 * mark reads fine, unlike the wide horizontal slot the default variant's
 * doc comment above found it too abstract for.
 */
export default function AgencyLogo({ logoUrl, name, variant = 'default' }) {
  const [failed, setFailed] = useState(false);

  if (variant === 'footer') {
    if (logoUrl && !failed) {
      return (
        <div className="flex min-w-0 items-center gap-2">
          <img
            src={logoUrl}
            alt={name || 'Agence'}
            loading="lazy"
            onError={() => setFailed(true)}
            className="h-8 w-8 shrink-0 rounded-full border border-line object-cover"
          />
          <span className="truncate text-[0.8125rem] font-semibold text-ink-70">{name || 'Agence'}</span>
        </div>
      );
    }
    if (name) {
      return <span className="truncate text-[0.8125rem] font-semibold text-ink-70">{name}</span>;
    }
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Monogram className="h-8 w-8 shrink-0 rounded-full border border-line" />
        <span className="truncate text-[0.8125rem] font-semibold text-ink-70">Lukka Place</span>
      </div>
    );
  }

  if (!logoUrl || failed) {
    if (name) {
      return <span className="shrink-0 text-right text-[0.8125rem] font-semibold leading-tight text-ink-70">{name}</span>;
    }
    return (
      <img
        src="/brand/logo-light.png"
        alt="Lukka Place"
        width={2354}
        height={746}
        className="h-5 w-auto shrink-0 object-contain"
      />
    );
  }

  return (
    <img
      src={logoUrl}
      alt={name || 'Agence'}
      loading="lazy"
      onError={() => setFailed(true)}
      className="max-h-10 w-auto shrink-0 object-contain"
    />
  );
}
