'use client';

import { useState } from 'react';
import { Link2, Check } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

/** Copies `url` to the clipboard with a real "Copié !" confirmation — same feedback pattern as WhatsAppPortfolioGenerator.js's own copy button. */
/**
 * `label` may be omitted for an icon-only button (the agent hero's share
 * bar) — pass `ariaLabel` in that case so the control still has an
 * accessible name. The copied state swaps the icon either way, so the
 * feedback survives without visible text.
 */
export default function CopyLinkButton({
  url,
  label,
  ariaLabel,
  className = '',
  iconClassName = 'h-[18px] w-[18px]',
}) {
  const t = useT();
  // See ShareOnWhatsAppButton on why this is not a parameter default.
  const copyLabel = label ?? t('listings.share.copyLink');
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
      aria-label={ariaLabel || (copyLabel ? undefined : t('listings.share.copyLink'))}
      title={ariaLabel}
    >
      {copied ? (
        <Check strokeWidth={ICON_STROKE_WIDTH} className={iconClassName} />
      ) : (
        <Link2 strokeWidth={ICON_STROKE_WIDTH} className={iconClassName} />
      )}
      {/* `copyLabel`, not the raw prop: the original applied its default in
          the parameter list, so every later reference already saw it. A
          caller passing label="" (the agent hero's icon-only button) still
          gets no text, since ?? only substitutes null/undefined. */}
      {copyLabel ? (copied ? t('listings.share.copied') : copyLabel) : null}
    </button>
  );
}
