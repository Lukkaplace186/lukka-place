'use client';

import { Printer } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/** The browser's own print dialog — "Save as PDF" included. The console chrome is print:hidden. */
export default function PrintButton({ label }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="u-press u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-ink hover:border-blue"
    >
      <Printer strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
      {label}
    </button>
  );
}
