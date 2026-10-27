'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { BUTTON } from '../sales/styles';

/** The built link with a copy button. */
export default function CopyLink({ url }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="u-micro min-w-0 flex-1 break-all rounded-lg bg-canvas-alt px-3 py-2 text-ink">{url}</code>
      <button type="button" onClick={copy} className={BUTTON}>
        {copied ? <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" /> : <Copy strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />}
        {copied ? t('admin.links.copied') : t('admin.links.copy')}
      </button>
    </div>
  );
}
