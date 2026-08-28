'use client';

import { ArrowUpRight, Share2 } from 'lucide-react';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * "Partager la page sur WhatsApp" — distinct from WhatsAppCTA.js (which
 * messages the agent directly): this shares the profile URL itself, so it
 * targets whichever contact the visitor picks, not a fixed number.
 * navigator.share() (native share sheet) when available, since it also
 * covers non-WhatsApp targets a visitor might actually pick; a plain wa.me
 * composer link (empty recipient) otherwise.
 */
export default function ShareOnWhatsAppButton({
  url,
  title,
  message,
  label = 'Partager la page sur WhatsApp',
  showArrow = false,
  iconOnly = false,
  className = 'u-press inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3.5 py-1.5 text-[0.8125rem] font-medium text-ink-70 transition-colors hover:border-green hover:text-green-deep',
}) {
  async function handleClick() {
    const text = message || `${title} — ${url}`;

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // User cancelled or the share sheet failed — fall through to wa.me.
      }
    }

    window.open(buildWhatsAppLink('', text), '_blank', 'noopener,noreferrer');
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={className}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
    >
      {iconOnly ? (
        <Share2 strokeWidth={ICON_STROKE_WIDTH} className="h-[18px] w-[18px]" />
      ) : (
        <>
          {label}
          {showArrow && (
            <ArrowUpRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
          )}
        </>
      )}
    </button>
  );
}
