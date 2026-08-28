'use client';

import { useState } from 'react';
import { Link2, Check } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/** Copies `url` to the clipboard with a real "Copié !" confirmation — same feedback pattern as WhatsAppPortfolioGenerator.js's own copy button. */
/**
 * `label` may be omitted for an icon-only button (the agent hero's share
 * bar) — pass `ariaLabel` in that case so the control still has an
 * accessible name. The copied state swaps the icon either way, so the
 * feedback survives without visible text.
 */
export default function CopyLinkButton({ url, label = 'Copier le lien', ariaLabel, className = '' }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={className}
      aria-label={ariaLabel || (label ? undefined : 'Copier le lien')}
      title={ariaLabel}
    >
      {copied ? (
        <Check strokeWidth={ICON_STROKE_WIDTH} className="h-[18px] w-[18px]" />
      ) : (
        <Link2 strokeWidth={ICON_STROKE_WIDTH} className="h-[18px] w-[18px]" />
      )}
      {label ? (copied ? 'Copié !' : label) : null}
    </button>
  );
}
