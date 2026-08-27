'use client';

import { useState } from 'react';
import { Link2, Check } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/** Copies `url` to the clipboard with a real "Copié !" confirmation — same feedback pattern as WhatsAppPortfolioGenerator.js's own copy button. */
export default function CopyLinkButton({ url, label = 'Copier le lien', className = '' }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" onClick={handleCopy} className={className}>
      {copied ? (
        <Check strokeWidth={ICON_STROKE_WIDTH} className="h-[18px] w-[18px]" />
      ) : (
        <Link2 strokeWidth={ICON_STROKE_WIDTH} className="h-[18px] w-[18px]" />
      )}
      {copied ? 'Copié !' : label}
    </button>
  );
}
