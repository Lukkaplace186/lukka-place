'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Flag } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

// The form only loads when someone taps (web/CLAUDE.md, "Mobile performance":
// dialogs that open on a tap are next/dynamic, never in the first load).
const ReportListingDialog = dynamic(() => import('./ReportListingDialog'), { ssr: false });

/**
 * "Signaler cette annonce" (2026-11-27): a quiet line at the foot of a
 * listing, website and app alike. The reasons and the storage are
 * lib/listingReportRules.js and lib/listingReports.js.
 */
export default function ReportListingButton({ listingId, className = '' }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`u-press inline-flex min-h-11 items-center gap-2 text-[0.8125rem] font-semibold text-ink-45 hover:text-ink ${className}`}
      >
        <Flag strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
        {t('listings.detail.report.open')}
      </button>
      {open ? <ReportListingDialog listingId={listingId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
