'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, CheckCircle2, Save, Star, Trash2, XCircle } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import { useToast } from '@/components/Toast';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { REJECTION_REASON_CODES, REJECTION_REASON_LABEL_KEYS } from '@/lib/moderation';
import { useT } from '@/lib/i18n/client';
import { moderateListingsAction } from '../actions';
import { adminSetListingGalleryAction } from './actions';

const BUTTON =
  'u-press u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-ink transition-colors hover:border-blue disabled:opacity-50';

/**
 * The listing's moderation decision and its photos, beside the metadata editor.
 * Reject asks for a reason (the agent is told it). Photos can be reordered,
 * re-covered or removed; only photos already on the listing can be kept, so no
 * foreign image can be attached from here.
 */
export default function ListingModerationPanel({ listingId, info, canModerate, canEdit }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState(info.photos);
  const dirty = photos.join('|') !== info.photos.join('|');

  function run(action, onDone) {
    startTransition(async () => {
      let result;
      try {
        result = await action();
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      if (!result?.ok) {
        showToast({ type: 'error', message: result?.error || t('errors.actionFailed') });
        return;
      }
      if (result.skipped?.length) {
        showToast({ type: 'error', message: result.skipped[0].reason });
        return;
      }
      showToast({ type: 'success', message: result.message || t('admin.moderation.decisionSaved') });
      onDone?.();
      router.refresh();
    });
  }

  function move(index, delta) {
    setPhotos((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {canModerate ? (
        <section className="u-card flex flex-col gap-3 rounded-card bg-surface p-5">
          <h2 className="u-title-card text-ink">{t('admin.moderation.decisionTitle')}</h2>
          {info.approveStatus === 2 && (info.reasonCode || info.note) ? (
            <p className="u-micro rounded-md bg-danger-tint px-3 py-2 text-danger">
              {info.reasonCode ? t(REJECTION_REASON_LABEL_KEYS[info.reasonCode]) : ''}
              {info.note ? ` — ${info.note}` : ''}
            </p>
          ) : null}
          {info.moderatedAt ? (
            <p className="u-micro text-ink-45">
              {t('admin.moderation.lastDecision', {
                date: new Date(info.moderatedAt).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' }),
                who: info.moderatedByName || t('admin.chrome.sharedSession'),
              })}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {info.approveStatus !== 1 ? (
              <button type="button" className={BUTTON} disabled={pending} onClick={() => run(() => moderateListingsAction({ ids: [listingId], decision: 'approve' }))}>
                <CheckCircle2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-success" />
                {t('admin.actions.approve')}
              </button>
            ) : null}
          </div>
          {info.approveStatus !== 2 ? (
            <div className="flex flex-col gap-2 border-t border-line pt-3">
              <select
                value={reasonCode}
                onChange={(event) => setReasonCode(event.target.value)}
                aria-label={t('admin.moderation.reasonLabel')}
                className="u-focus-ring u-micro h-9 rounded-lg border border-line bg-surface px-2.5 text-ink"
              >
                <option value="">{t('admin.moderation.reasonLabel')}</option>
                {REJECTION_REASON_CODES.map((code) => (
                  <option key={code} value={code}>{t(REJECTION_REASON_LABEL_KEYS[code])}</option>
                ))}
              </select>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                maxLength={500}
                placeholder={t('admin.moderation.notePlaceholder')}
                className="u-focus-ring rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink"
              />
              <button
                type="button"
                disabled={pending || !reasonCode}
                onClick={() => run(() => moderateListingsAction({ ids: [listingId], decision: 'reject', reasonCode, note }), () => {
                  setReasonCode('');
                  setNote('');
                })}
                className="u-press inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-danger px-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                <XCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                {t('admin.moderation.confirmReject')}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="u-card flex flex-col gap-3 rounded-card bg-surface p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="u-title-card text-ink">{t('admin.photos.title')}</h2>
          <span className="u-micro text-ink-45">{t('admin.moderation.photoCount', { count: photos.length })}</span>
        </div>
        {photos.length === 0 ? (
          <p className="u-micro text-ink-45">{t('admin.photos.none')}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2">
            {photos.map((src, index) => (
              <li key={src} className="flex flex-col gap-1">
                <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-canvas-alt">
                  <SafeImage src={src} alt="" fill sizes="160px" className="object-cover" />
                  {index === 0 ? (
                    <span className="absolute left-1 top-1 rounded bg-ink/80 px-1.5 text-[0.625rem] font-bold text-white">{t('admin.photos.cover')}</span>
                  ) : null}
                </div>
                {canEdit ? (
                  <div className="flex items-center justify-between gap-1">
                    <button type="button" className="rounded p-1 text-ink-45 hover:bg-canvas-alt hover:text-ink disabled:opacity-30" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t('admin.photos.moveLeft')}>
                      <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className="rounded p-1 text-ink-45 hover:bg-canvas-alt hover:text-ink disabled:opacity-30" disabled={index === 0} onClick={() => setPhotos((current) => [src, ...current.filter((item) => item !== src)])} aria-label={t('admin.photos.makeCover')}>
                      <Star strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className="rounded p-1 text-danger hover:bg-danger-tint" onClick={() => setPhotos((current) => current.filter((item) => item !== src))} aria-label={t('admin.photos.remove')}>
                      <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className="rounded p-1 text-ink-45 hover:bg-canvas-alt hover:text-ink disabled:opacity-30" disabled={index === photos.length - 1} onClick={() => move(index, 1)} aria-label={t('admin.photos.moveRight')}>
                      <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit && dirty ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON} disabled={pending} onClick={() => run(() => adminSetListingGalleryAction(listingId, photos))}>
              <Save strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('admin.photos.save')}
            </button>
            <button type="button" className={BUTTON} disabled={pending} onClick={() => setPhotos(info.photos)}>
              {t('common.actions.cancel')}
            </button>
          </div>
        ) : null}
        <p className="u-micro text-ink-45">{t('admin.photos.hint')}</p>
      </section>
    </div>
  );
}
