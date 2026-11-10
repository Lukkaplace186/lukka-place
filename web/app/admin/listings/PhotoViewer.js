'use client';

import { useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { formatPrice } from '@/lib/format';
import { placeLabel } from '@/lib/placeLabel';
import { useT } from '@/lib/i18n/client';

/**
 * Every photo of one listing, large, from the queue without leaving it.
 * ← → change photo (only while the viewer is open), a swipe does on a phone.
 * Approve / reject from here when the row can be decided. The caller keys
 * it by listing, so each listing opens on its first photo.
 */
export default function PhotoViewer({ row, open, onOpenChange, onApprove = null, onReject = null, busy = false }) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const touchX = useRef(null);
  const photos = row?.photos || [];
  const count = photos.length;

  function go(delta) {
    if (!count) return;
    setIndex((current) => (current + delta + count) % count);
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
  }

  if (!row) return null;
  const place = placeLabel({ quartier: row.quartier, commune: row.commune });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={onKeyDown}
        className="flex h-[min(92dvh,56rem)] w-[min(96vw,80rem)] max-w-none flex-col gap-3 border-0 bg-ink p-3 text-white sm:max-w-none sm:p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 pr-10">
          <div className="min-w-0">
            <DialogTitle className="truncate text-base font-bold text-white">{t('admin.moderation.viewer.photosOf')} <span className="u-tabular font-normal text-white/70">#{row.id}</span></DialogTitle>
            <DialogDescription className="u-micro truncate text-white/70">
              {[row.title, place, row.price ? formatPrice(row.price, row.purpose, row.pricePeriod) : null].filter(Boolean).join(' · ')}
            </DialogDescription>
          </div>
          <span className="u-tabular font-bold">{count ? `${index + 1} / ${count}` : '0'}</span>
        </div>

        <div
          className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black/40"
          onTouchStart={(event) => { touchX.current = event.touches[0].clientX; }}
          onTouchEnd={(event) => {
            if (touchX.current == null) return;
            const dx = event.changedTouches[0].clientX - touchX.current;
            touchX.current = null;
            if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
          }}
        >
          {count ? (
            <SafeImage key={photos[index]} src={photos[index]} alt={t('admin.moderation.viewer.photoOf', { n: index + 1, total: count })} fill sizes="96vw" className="object-contain" />
          ) : (
            <p className="absolute inset-0 grid place-items-center text-white/70">{t('admin.moderation.viewer.noPhoto')}</p>
          )}
          {count > 1 ? (
            <>
              <button type="button" onClick={() => go(-1)} aria-label={t('admin.moderation.viewer.previous')} className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 hover:bg-white/25">
                <ChevronLeft strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
              </button>
              <button type="button" onClick={() => go(1)} aria-label={t('admin.moderation.viewer.next')} className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 hover:bg-white/25">
                <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
              </button>
            </>
          ) : null}
        </div>

        {count > 1 ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photos.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={t('admin.moderation.viewer.photoOf', { n: i + 1, total: count })}
                aria-current={i === index ? 'true' : undefined}
                className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-md ${i === index ? 'outline outline-2 outline-offset-2 outline-white' : 'opacity-60 hover:opacity-100'}`}
              >
                <SafeImage src={src} alt="" fill sizes="80px" className="object-cover" />
              </button>
            ))}
          </div>
        ) : null}

        {onApprove || onReject ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {onReject ? (
              <button type="button" disabled={busy} onClick={onReject} className="u-press inline-flex h-11 items-center gap-2 rounded-lg border border-white/50 px-4 font-bold hover:bg-white/10 disabled:opacity-50">
                <X strokeWidth={2.25} className="h-4 w-4" />
                {t('admin.moderation.review.reject')}
              </button>
            ) : null}
            {onApprove ? (
              <button type="button" disabled={busy} onClick={onApprove} className="u-press inline-flex h-11 items-center gap-2 rounded-lg bg-success px-5 font-bold text-white disabled:opacity-50">
                <Check strokeWidth={2.5} className="h-4 w-4" />
                {t('admin.moderation.review.approve')}
              </button>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
