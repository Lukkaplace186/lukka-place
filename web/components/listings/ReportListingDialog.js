'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { REPORT_NOTE_MAX, REPORT_REASONS } from '@/lib/listingReportRules';
import { reportListingAction } from '@/app/(site)/listings/[id]/reportActions';

/**
 * The "Signaler cette annonce" form (loaded by ReportListingButton on tap):
 * one reason, an optional note, then a plain thank-you. The action can be
 * rejected on a dropped connection (web/CLAUDE.md, "A 413 reaches the caller
 * as a rejected promise"), so the pending flag is cleared in `finally`.
 */
export default function ReportListingDialog({ listingId, onClose }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set('reason', reason);
      formData.set('note', note);
      const result = await reportListingAction(listingId, formData);
      if (result?.ok) setDone(true);
      else setError(result?.error || 'listings.detail.report.errors.failed');
    } catch {
      setError('listings.detail.report.errors.offline');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[88dvh] max-w-md overflow-y-auto">
        {done ? (
          <div className="flex flex-col items-start gap-3 py-2">
            <CheckCircle2 strokeWidth={ICON_STROKE_WIDTH} className="h-8 w-8 text-green-ink" aria-hidden="true" />
            <DialogHeader>
              <DialogTitle>{t('listings.detail.report.thanksTitle')}</DialogTitle>
              <DialogDescription>{t('listings.detail.report.thanksBody')}</DialogDescription>
            </DialogHeader>
            <button type="button" onClick={onClose} className="u-press mt-1 inline-flex h-11 items-center rounded-lg bg-blue px-5 text-sm font-bold text-white">
              {t('listings.detail.report.close')}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t('listings.detail.report.title')}</DialogTitle>
              <DialogDescription>{t('listings.detail.report.lead')}</DialogDescription>
            </DialogHeader>
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">{t('listings.detail.report.reasonLabel')}</legend>
              {REPORT_REASONS.map((value) => (
                <label
                  key={value}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm ${
                    reason === value ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-surface text-ink-70'
                  }`}
                >
                  <input
                    type="radio"
                    name="reason"
                    value={value}
                    checked={reason === value}
                    onChange={() => setReason(value)}
                    className="h-4 w-4 accent-[var(--blue)]"
                  />
                  {t(`listings.detail.report.reasons.${value}`)}
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1.5 text-[0.8125rem] font-semibold text-ink-70">
              {t(reason === 'other' ? 'listings.detail.report.noteRequired' : 'listings.detail.report.noteLabel')}
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={REPORT_NOTE_MAX}
                rows={3}
                className="u-focus-ring rounded-lg border border-line bg-surface px-3 py-2 text-base font-normal text-ink placeholder:text-ink-35"
                placeholder={t('listings.detail.report.notePlaceholder')}
              />
            </label>
            {error ? <p role="alert" className="text-sm text-danger">{t(error)}</p> : null}
            <p className="text-xs text-ink-45">{t('listings.detail.report.privacy')}</p>
            <button
              type="submit"
              disabled={!reason || pending}
              className="u-press inline-flex h-12 items-center justify-center rounded-lg bg-blue px-5 text-[0.9375rem] font-bold text-white disabled:bg-canvas-deep disabled:text-ink-35"
            >
              {pending ? t('listings.detail.report.sending') : t('listings.detail.report.submit')}
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
