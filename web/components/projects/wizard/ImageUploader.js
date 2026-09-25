'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImagePlus, Loader2 } from 'lucide-react';
import { shrinkPhotos } from '@/lib/photoShrink';
import { validatePhotoSelection } from '@/lib/uploadLimits.mjs';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * Pick photos, shrink them on the phone (lib/photoShrink.js: 1600px JPEG, a
 * 4 MB camera photo becomes ~300 KB, GPS EXIF dropped), check them with the
 * same rule the server applies, then send them to `action` (a bound Server
 * Action returning { ok, error }). The page refreshes to show them.
 *
 * A rejected promise (dropped connection, expired session) is caught and
 * said — never a dead button (web/CLAUDE.md, "A 413 reaches the caller as a
 * rejected promise").
 *
 * `extraFields` are appended to the FormData (the construction update's date
 * and caption travel with its photos).
 */
export default function ImageUploader({ action, labels, multiple = true, required = false, formRef = null, onDone = null }) {
  const router = useRouter();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function send(files) {
    setError(null);
    setDone(null);
    const picked = Array.from(files || []);
    if (!picked.length && required) return;
    let shrunk = [];
    if (picked.length) {
      setBusy(labels.optimising);
      shrunk = await shrinkPhotos(picked);
      const problem = validatePhotoSelection(shrunk, { allowedTypes: ['image/jpeg', 'image/png', 'image/webp'] });
      if (problem) {
        setBusy(null);
        setError(labels.tooLarge);
        return;
      }
    }
    setBusy(labels.sending);
    const formData = formRef?.current ? new FormData(formRef.current) : new FormData();
    formData.delete('images');
    for (const file of shrunk) formData.append('images', file);
    try {
      const result = await action(formData);
      if (result?.ok) {
        setDone(labels.done);
        if (inputRef.current) inputRef.current.value = '';
        formRef?.current?.reset();
        onDone?.();
        router.refresh();
      } else {
        setError(result?.error || labels.failed);
      }
    } catch {
      setError(navigator.onLine === false ? labels.offline : labels.failed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className={`u-press inline-flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-full border border-dashed border-ink-25 bg-surface px-4 text-sm font-semibold text-ink ${busy ? 'pointer-events-none opacity-60' : ''}`}>
        {busy ? <Loader2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 animate-spin" /> : <ImagePlus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />}
        {busy || labels.pick}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple={multiple}
          className="sr-only"
          onChange={(event) => send(event.target.files)}
        />
      </label>
      {labels.hint ? <p className="text-[0.75rem] text-ink-45">{labels.hint}</p> : null}
      {error ? <p className="text-[0.8125rem] font-semibold text-danger" role="alert">{error}</p> : null}
      {done ? <p className="text-[0.8125rem] text-success" role="status">{done}</p> : null}
    </div>
  );
}
