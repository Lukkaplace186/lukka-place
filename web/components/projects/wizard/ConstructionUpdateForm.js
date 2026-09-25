'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { shrinkPhotos } from '@/lib/photoShrink';
import { validatePhotoSelection } from '@/lib/uploadLimits.mjs';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * "Ajouter une mise à jour du chantier" from the phone: the date the photos
 * show (never in the future), a caption, photos. Photos are shrunk before
 * sending; the action answers { ok, error }.
 */
export default function ConstructionUpdateForm({ action, labels, today }) {
  const router = useRouter();
  const formRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setDone(false);
    const form = formRef.current;
    const formData = new FormData(form);
    const picked = formData.getAll('images').filter((f) => f && typeof f !== 'string' && f.size > 0);
    setBusy(true);
    try {
      const shrunk = await shrinkPhotos(picked);
      if (validatePhotoSelection(shrunk, { allowedTypes: ['image/jpeg', 'image/png', 'image/webp'] })) {
        setError(labels.tooLarge);
        return;
      }
      formData.delete('images');
      for (const file of shrunk) formData.append('images', file);
      const result = await action(formData);
      if (result?.ok) {
        form.reset();
        setDone(true);
        router.refresh();
      } else {
        setError(result?.error || labels.failed);
      }
    } catch {
      setError(navigator.onLine === false ? labels.offline : labels.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <label className="flex flex-col gap-1">
        <span className="u-micro-strong text-ink-70">{labels.date}</span>
        <input type="date" name="taken_on" required max={today} defaultValue={today} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="u-micro-strong text-ink-70">{labels.caption}</span>
        <input name="caption" maxLength={500} placeholder={labels.captionExample} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm" />
      </label>
      <input type="file" name="images" accept="image/jpeg,image/png,image/webp" multiple className="text-sm sm:col-span-2" />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={busy} className="u-btn-primary inline-flex min-h-11 items-center gap-2 rounded-full bg-blue px-5 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? <Loader2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 animate-spin" /> : null}
          {labels.submit}
        </button>
        {error ? <p className="text-[0.8125rem] font-semibold text-danger" role="alert">{error}</p> : null}
        {done ? <p className="text-[0.8125rem] text-success" role="status">{labels.done}</p> : null}
      </div>
    </form>
  );
}
