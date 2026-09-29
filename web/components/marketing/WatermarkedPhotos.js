'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Share2 } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { watermarkFileName } from '@/lib/marketing/watermark';
import { renderWatermarked } from './CanvasRenderer';

/**
 * "Photos avec mon logo": every listing photo (the pack's `gallery`, ≤ 10,
 * same-origin /_next/image URLs so the canvas is never tainted) with the
 * agent's band drawn over its bottom edge (lib/marketing/watermark.js).
 *
 * Drawn in the browser, one photo at a time, only while this tab is open.
 * "Tout partager" uses the share sheet with every file when the phone allows
 * it (`canShare({files})`), else downloads them one by one, 350 ms apart —
 * browsers drop downloads fired together. Recorded as `watermarked_photo`
 * (kit_share / kit_download), once per action, after it happened.
 *
 * Online only: the gallery is not stored with the offline pack (ten photos
 * would triple what a phone keeps for one listing).
 */
export default function WatermarkedPhotos({ listingId, pack, logo, family, caption, onRecord }) {
  const t = useT();
  const [items, setItems] = useState([]); // { url, file }
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'failed'
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const urls = useRef([]);

  useEffect(() => {
    let cancelled = false;
    const gallery = pack?.gallery?.length ? pack.gallery : pack?.photos || [];
    (async () => {
      const done = [];
      for (const [index, src] of gallery.entries()) {
        try {
          const res = await fetch(src);
          if (!res.ok) continue;
          const rendered = await renderWatermarked(await res.blob(), { agent: pack.agent || {}, logo }, family);
          if (!rendered || cancelled) continue;
          const file = new File([rendered.blob], watermarkFileName(listingId, index), { type: 'image/jpeg' });
          const url = URL.createObjectURL(file);
          urls.current.push(url);
          done.push({ url, file });
          if (!cancelled) setItems([...done]);
        } catch {
          // One photo that fails to load or draw is skipped; the rest go on.
        }
      }
      if (!cancelled) setStatus(done.length ? 'ready' : 'failed');
    })();
    return () => {
      cancelled = true;
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      urls.current = [];
    };
  }, [pack, logo, family, listingId]);

  function download(item) {
    const a = document.createElement('a');
    a.href = item.url;
    a.download = item.file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function shareAll() {
    setBusy(true);
    setNote(null);
    const files = items.map((item) => item.file);
    try {
      if (navigator.canShare?.({ files })) {
        await navigator.share({ files, text: caption || undefined });
        onRecord?.({ channel: 'kit_share', format: 'watermarked_photo' });
      } else {
        for (const [i, item] of items.entries()) {
          if (i > 0) await new Promise((resolve) => setTimeout(resolve, 350));
          download(item);
        }
        onRecord?.({ channel: 'kit_download', format: 'watermarked_photo' });
        setNote(t('agent.share.photos.downloaded', { count: items.length }));
      }
    } catch (err) {
      if (err?.name !== 'AbortError') setNote(t('agent.share.shareFailed'));
    } finally {
      setBusy(false);
    }
  }

  const action = 'u-press inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold disabled:opacity-50';

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-sm text-ink-70">{t('agent.share.photos.intro')}</p>
      {!pack?.agent?.name && !pack?.agent?.logo ? (
        <p className="rounded-lg bg-canvas-alt p-2.5 text-xs text-ink-70">{t('agent.share.photos.noBrand')}</p>
      ) : null}

      <div className="grid grid-cols-3 gap-1.5">
        {items.map((item) => (
          <button
            key={item.url}
            type="button"
            onClick={() => {
              download(item);
              onRecord?.({ channel: 'kit_download', format: 'watermarked_photo' });
            }}
            className="u-press relative aspect-square overflow-hidden rounded-lg border border-line"
            aria-label={t('agent.share.photos.downloadOne', { name: item.file.name })}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.url} alt="" className="h-full w-full object-cover" />
            <Download strokeWidth={ICON_STROKE_WIDTH} className="absolute bottom-1 right-1 h-4 w-4 rounded bg-white/90 p-0.5 text-ink" />
          </button>
        ))}
        {status === 'loading'
          ? Array.from({ length: Math.max(1, Math.min(3, (pack?.gallery?.length || 3) - items.length)) }, (_, i) => (
            <div key={`ph-${i}`} className="aspect-square animate-pulse rounded-lg bg-canvas-alt" />
          ))
          : null}
      </div>

      {status === 'failed' ? <p className="text-sm text-danger" role="alert">{t('agent.share.photos.failed')}</p> : null}
      {note ? <p className="text-sm text-ink-70" role="status">{note}</p> : null}

      <button type="button" onClick={shareAll} disabled={busy || items.length === 0} className={`${action} u-btn-primary bg-blue text-white`}>
        <Share2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        {busy ? t('agent.share.preparing') : t('agent.share.photos.shareAll', { count: items.length })}
      </button>
      <p className="text-xs text-ink-45">{t('agent.share.photos.hint')}</p>
    </div>
  );
}
