'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, Check, Copy, Download, MessageCircle, Share2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { buildWhatsAppShareLink } from '@/lib/whatsapp';
import { getMandateReportAction, getSharePackAction } from '@/app/compte/agent/shareActions';
import { FORMATS, FORMAT_KEYS, formatFileName } from '@/lib/marketing/formats';
import { LISTING_TIME_ZONE } from '@/lib/listingView';
import { fetchPackImages, isStale, loadSharePack, packTimestamp, saveSharePack } from '@/lib/sharePack';
import { decodeAssets, loadRenderFont, renderFlyer, renderReport } from './marketing/CanvasRenderer';
import { useToast } from './Toast';
import { useLocale, useT } from '@/lib/i18n/client';

const BLOCKER_KEYS = {
  pending: 'agent.share.blocked.pending',
  rejected: 'agent.share.blocked.rejected',
  archived: 'agent.share.blocked.archived',
  under_offer: 'agent.share.blocked.underOffer',
  closed: 'agent.share.blocked.closed',
};

// Preview box per format: the square keeps the size that fits a phone dialog
// above its buttons; the 9:16 is narrower so it is no taller.
const PREVIEW_CLASS = {
  square: 'max-w-[13.5rem] sm:max-w-[18rem]',
  story: 'max-w-[8.5rem] sm:max-w-[11rem]',
  landscape: 'max-w-[18rem] sm:max-w-full',
};

function releaseAssets(assets) {
  for (const image of Object.values(assets?.images || {})) image?.close?.();
}

/**
 * "Visuel & partage" — the agent's marketing kit for a listing, in three tabs:
 *
 *   Visuel        the listing graphic in three formats (square post, 9:16
 *                 Status, 16:9 link card), DRAWN IN THE BROWSER from a share
 *                 pack (components/marketing/CanvasRenderer.js). No server
 *                 render, and it works offline from the copy lib/sharePack.js
 *                 keeps — stamped with the date of that copy, because an
 *                 offline graphic can show an old price.
 *   Texte         the caption, copy + wa.me.
 *   Propriétaire  the landlord report: live counts from the server, card
 *                 drawn in the browser, caption that says what the counts
 *                 cover and what they do not.
 *
 * The server flyer (/compte/agent/biens/:id/visuel) stays as the square
 * fallback when the browser cannot draw (a failed decode, an old canvas), and
 * only while online.
 *
 * Sharing: Web Share with the JPEG attached. On a phone that is the system
 * sheet → WhatsApp → "Mon statut" (or a chat, a broadcast list, a Facebook
 * group). There is no web link that posts to a WhatsApp Status directly — the
 * share sheet IS the one-tap path, so the caption is copied first and the hint
 * says so, because WhatsApp drops text attached to an image shared to Status.
 *
 * PHONE LAYOUT. The actions sit directly under a reduced preview, before the
 * caption; height is `dvh` and the bottom padding clears the home indicator
 * (a `vh` dialog put the last button under iPhone Safari's toolbar).
 *
 * Mounted as a SIBLING of the actions menu, never inside a menu item — see
 * AgentListingActionsMenu's note on Radix unmounting dialogs with the menu.
 */
export default function AgentListingShareKit({ listingId, open, onOpenChange }) {
  const t = useT();
  const locale = useLocale();
  const { showToast } = useToast();

  const [kit, setKit] = useState(null);
  const [failure, setFailure] = useState(null); // 'load' | 'offline'
  const [source, setSource] = useState(null); // { type: 'live'|'cache', at }
  const [blobs, setBlobs] = useState(null);
  const [assets, setAssets] = useState(null);
  const [family, setFamily] = useState(null);
  const [format, setFormat] = useState('square');
  const [preview, setPreview] = useState(null); // { url, blob, format }
  const [renderFailed, setRenderFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null);
  const [report, setReport] = useState({ status: 'idle' });
  const previewUrlRef = useRef(null);
  const reportUrlRef = useRef(null);

  // 1. The kit: live when the server answers, the stored copy when it cannot.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      let result = null;
      try {
        result = await getSharePackAction(listingId);
      } catch {
        result = null; // unreachable — try the stored copy
      }
      if (cancelled) return;

      if (result?.ok) {
        setKit(result);
        setSource({ type: 'live', at: packTimestamp(result) });
        let images = { photos: [], logo: null, mark: null };
        try {
          images = await fetchPackImages(result.pack, { signal: controller.signal });
        } catch {
          // Aborted by closing the dialog; the check below ends it.
        }
        if (cancelled) return;
        setBlobs(images);
        // A download that lost every photo (the connection dropped halfway)
        // must not overwrite a good stored copy.
        if (images.photos.length || !result.pack.photos.length) {
          saveSharePack(listingId, { kit: result, ...images });
        }
        return;
      }
      if (result && !result.ok) {
        // The server answered "not yours" / "gone": never fall back to a copy.
        setFailure('load');
        return;
      }

      const stored = await loadSharePack(listingId);
      if (cancelled) return;
      if (!stored) {
        setFailure('offline');
        return;
      }
      setKit(stored.kit);
      setSource({ type: 'cache', at: packTimestamp(stored.kit) ?? stored.savedAt });
      setBlobs({ photos: stored.photos || [], logo: stored.logo || null, mark: stored.mark || null });
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, listingId]);

  // 2. Decode once per download; every format redraws from the same bitmaps.
  useEffect(() => {
    if (!blobs) return undefined;
    let cancelled = false;
    let decoded = null;
    Promise.all([loadRenderFont(), decodeAssets(blobs)])
      .then(([loadedFamily, result]) => {
        decoded = result;
        if (cancelled) {
          releaseAssets(result);
          return;
        }
        setFamily(loadedFamily);
        setAssets(result);
      })
      .catch(() => {
        if (!cancelled) setRenderFailed(true);
      });
    return () => {
      cancelled = true;
      releaseAssets(decoded);
    };
  }, [blobs]);

  // 3. Draw the selected format.
  useEffect(() => {
    if (!assets || !family || !kit?.shareable) return undefined;
    let cancelled = false;
    renderFlyer(kit.pack, format, assets, family)
      .then(({ blob }) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = url;
        setRenderFailed(false);
        setPreview({ url, blob, format });
      })
      .catch(() => {
        if (!cancelled) setRenderFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [assets, family, format, kit]);

  const reset = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    if (reportUrlRef.current) URL.revokeObjectURL(reportUrlRef.current);
    previewUrlRef.current = null;
    reportUrlRef.current = null;
    setKit(null);
    setFailure(null);
    setSource(null);
    setBlobs(null);
    setAssets(null);
    setPreview(null);
    setRenderFailed(false);
    setCopied(null);
    setReport({ status: 'idle' });
  }, []);

  useEffect(() => reset, [reset]);

  function handleOpenChange(next) {
    if (!next) reset();
    onOpenChange(next);
  }

  // The server-drawn square, only when the browser could not draw and the
  // server is reachable.
  const serverFallback = renderFailed && format === 'square' && source?.type === 'live';
  const serverImageSrc = `/compte/agent/biens/${listingId}/visuel`;
  const previewSrc = preview?.format === format ? preview.url : serverFallback ? serverImageSrc : null;

  const captionFor = (channel) => kit?.copies?.[channel] || kit?.copy || '';

  async function copyText(text, key) {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 2000);
      return true;
    } catch {
      return false;
    }
  }

  async function flyerFile() {
    if (preview?.format === format) {
      return new File([preview.blob], formatFileName(listingId, format), { type: 'image/jpeg' });
    }
    if (!serverFallback) throw new Error('no graphic');
    const res = await fetch(serverImageSrc, { cache: 'no-store' });
    if (!res.ok) throw new Error(`flyer ${res.status}`);
    const blob = await res.blob();
    return new File([blob], formatFileName(listingId, format), { type: blob.type || 'image/jpeg' });
  }

  function saveFile(file) {
    const href = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = href;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  async function shareFile(getFile, text, copyKey) {
    setBusy(true);
    // Started before any await, while the tap still counts as a user gesture
    // for the clipboard in Safari.
    const captionCopied = copyText(text, copyKey);
    try {
      const file = await getFile();
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
        if (await captionCopied) showToast({ type: 'success', message: t('agent.share.captionCopied') });
      } else {
        saveFile(file);
        showToast({ type: 'success', message: t('agent.share.downloadedInstead') });
      }
    } catch (err) {
      if (err?.name !== 'AbortError') showToast({ type: 'error', message: t('agent.share.shareFailed') });
    } finally {
      setBusy(false);
    }
  }

  async function download(getFile) {
    setBusy(true);
    try {
      saveFile(await getFile());
    } catch {
      showToast({ type: 'error', message: t('agent.share.shareFailed') });
    } finally {
      setBusy(false);
    }
  }

  async function prepareReport() {
    setReport({ status: 'loading' });
    let result;
    try {
      result = await getMandateReportAction(listingId);
    } catch {
      setReport({ status: 'offline' });
      return;
    }
    if (!result?.ok) {
      setReport({ status: 'failed' });
      return;
    }
    let decoded = null;
    try {
      const images = await fetchPackImages({ photos: result.photo ? [result.photo] : [], mark: result.mark });
      const [loadedFamily, loaded] = await Promise.all([loadRenderFont(), decodeAssets(images)]);
      decoded = loaded;
      const { blob } = await renderReport(result.report, loaded, loadedFamily);
      if (reportUrlRef.current) URL.revokeObjectURL(reportUrlRef.current);
      const url = URL.createObjectURL(blob);
      reportUrlRef.current = url;
      setReport({ status: 'ready', url, blob, caption: result.caption });
    } catch {
      setReport({ status: 'failed' });
    } finally {
      releaseAssets(decoded);
    }
  }

  const reportFile = async () => new File([report.blob], `lukka-place-rapport-${listingId}.jpg`, { type: 'image/jpeg' });

  const shareable = kit?.shareable === true;
  const stale = source?.type === 'cache' && isStale(source.at);
  const stampDate =
    source?.type === 'cache' && source.at
      ? new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: LISTING_TIME_ZONE,
        }).format(new Date(source.at))
      : null;
  const graphicReady = Boolean(previewSrc);

  const actionClass =
    'u-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-center text-[0.8125rem] font-bold leading-tight disabled:opacity-50 sm:gap-2 sm:px-4 sm:text-sm';
  const icon = 'h-4 w-4 shrink-0';
  const blockedNote = kit && !shareable && (
    <p className="rounded-lg bg-canvas-alt p-3 text-sm text-ink-70" role="status">
      {t(BLOCKER_KEYS[kit.blocker] || 'agent.share.blocked.pending')}
    </p>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[88dvh] gap-3 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:gap-4">
        <DialogHeader>
          <DialogTitle>{t('agent.share.title')}</DialogTitle>
          <DialogDescription>{t('agent.share.description')}</DialogDescription>
        </DialogHeader>

        {failure === 'load' && <p className="text-sm text-danger" role="alert">{t('agent.share.loadFailed')}</p>}
        {failure === 'offline' && <p className="text-sm text-ink-70" role="alert">{t('agent.share.offlineUnavailable')}</p>}
        {!kit && !failure && <p className="text-sm text-ink-45" role="status">{t('agent.share.loading')}</p>}

        {kit && (
          <Tabs defaultValue="image" className="min-w-0 gap-3">
            <TabsList className="h-10 w-full bg-canvas-alt">
              <TabsTrigger value="image" className="h-full">{t('agent.share.tabs.image')}</TabsTrigger>
              <TabsTrigger value="text" className="h-full">{t('agent.share.tabs.text')}</TabsTrigger>
              <TabsTrigger value="owner" className="h-full">{t('agent.share.tabs.owner')}</TabsTrigger>
            </TabsList>

            <TabsContent value="image" className="flex min-w-0 flex-col gap-3">
              {blockedNote}
              {shareable && (
                <>
                  {source?.type === 'cache' && (
                    <p
                      className={`rounded-lg p-2.5 text-xs ${stale ? 'bg-warning-tint text-ink' : 'bg-canvas-alt text-ink-70'}`}
                      role="status"
                      data-testid="share-offline-stamp"
                    >
                      {t('agent.share.offlineStamp', { date: stampDate || '—' })}
                      {stale && <span className="mt-1 block font-semibold">{t('agent.share.staleWarning')}</span>}
                    </p>
                  )}

                  <div role="radiogroup" aria-label={t('agent.share.formatsLabel')} className="grid grid-cols-3 gap-1.5">
                    {FORMAT_KEYS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={format === key}
                        onClick={() => setFormat(key)}
                        className={`u-press min-h-10 rounded-lg border px-1.5 text-xs font-bold sm:text-[0.8125rem] ${
                          format === key ? 'border-blue bg-blue-tint text-blue' : 'border-line text-ink-70'
                        }`}
                      >
                        {t(`agent.share.formats.${key}`)}
                      </button>
                    ))}
                  </div>

                  <div
                    className={`mx-auto w-full overflow-hidden rounded-xl border border-line bg-canvas-deep ${PREVIEW_CLASS[format]}`}
                    style={{ aspectRatio: `${FORMATS[format].width} / ${FORMATS[format].height}` }}
                  >
                    {previewSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewSrc} alt={t('agent.share.previewAlt')} className="h-full w-full object-cover" data-format={format} />
                    ) : (
                      <p className="grid h-full place-items-center p-4 text-center text-xs text-ink-45" role="status">
                        {renderFailed ? t('agent.share.imageFailed') : t('agent.share.rendering')}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => shareFile(flyerFile, captionFor('image'), 'image')}
                      disabled={busy || !graphicReady}
                      className={`${actionClass} u-btn-primary bg-blue text-white`}
                    >
                      <Share2 strokeWidth={ICON_STROKE_WIDTH} className={icon} />
                      {busy ? t('agent.share.preparing') : t('agent.share.shareImage')}
                    </button>
                    <button type="button" onClick={() => download(flyerFile)} disabled={busy || !graphicReady} className={`${actionClass} border border-line text-ink`}>
                      <Download strokeWidth={ICON_STROKE_WIDTH} className={icon} />
                      {t('agent.share.download')}
                    </button>
                  </div>
                  <p className="text-xs text-ink-45">{t('agent.share.statusHint')}</p>
                </>
              )}
            </TabsContent>

            <TabsContent value="text" className="flex min-w-0 flex-col gap-3">
              {blockedNote}
              {shareable && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <a href={buildWhatsAppShareLink(captionFor('whatsapp'))} target="_blank" rel="noopener noreferrer" className={`${actionClass} border border-line text-ink`}>
                      <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className={`${icon} text-green-deep`} />
                      {t('agent.share.sendWhatsApp')}
                    </a>
                    <button type="button" onClick={() => copyText(captionFor('copy'), 'copy')} className={`${actionClass} border border-line text-ink`}>
                      {copied === 'copy' ? <Check strokeWidth={ICON_STROKE_WIDTH} className={icon} /> : <Copy strokeWidth={ICON_STROKE_WIDTH} className={icon} />}
                      {copied === 'copy' ? t('agent.share.copied') : t('agent.share.copyCaption')}
                    </button>
                  </div>
                  <div className="min-w-0">
                    <label htmlFor={`share-copy-${listingId}`} className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
                      {t('agent.share.captionLabel')}
                    </label>
                    <textarea
                      id={`share-copy-${listingId}`}
                      readOnly
                      value={captionFor('copy')}
                      rows={9}
                      className="u-focus-ring w-full resize-none rounded-lg border border-line bg-surface p-3 text-base leading-relaxed text-ink sm:text-sm"
                    />
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="owner" className="flex min-w-0 flex-col gap-3">
              <p className="text-sm text-ink-70">{t('agent.share.owner.intro')}</p>

              {report.status !== 'ready' && (
                <button type="button" onClick={prepareReport} disabled={report.status === 'loading'} className={`${actionClass} u-btn-primary bg-blue text-white`}>
                  <BarChart3 strokeWidth={ICON_STROKE_WIDTH} className={icon} />
                  {report.status === 'loading' ? t('agent.share.owner.preparing') : t('agent.share.owner.prepare')}
                </button>
              )}
              {report.status === 'failed' && <p className="text-sm text-danger" role="alert">{t('agent.share.owner.failed')}</p>}
              {report.status === 'offline' && <p className="text-sm text-ink-70" role="alert">{t('agent.share.owner.offline')}</p>}

              {report.status === 'ready' && (
                <>
                  <div className="mx-auto aspect-square w-full max-w-[13.5rem] overflow-hidden rounded-xl border border-line sm:max-w-[18rem]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={report.url} alt={t('agent.share.owner.previewAlt')} className="h-full w-full object-cover" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => shareFile(reportFile, report.caption, 'report')}
                      disabled={busy}
                      className={`${actionClass} u-btn-primary col-span-2 bg-blue text-white`}
                    >
                      <Share2 strokeWidth={ICON_STROKE_WIDTH} className={icon} />
                      {busy ? t('agent.share.preparing') : t('agent.share.owner.share')}
                    </button>
                    <a href={buildWhatsAppShareLink(report.caption)} target="_blank" rel="noopener noreferrer" className={`${actionClass} border border-line text-ink`}>
                      <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className={`${icon} text-green-deep`} />
                      {t('agent.share.sendWhatsApp')}
                    </a>
                    <button type="button" onClick={() => download(reportFile)} disabled={busy} className={`${actionClass} border border-line text-ink`}>
                      <Download strokeWidth={ICON_STROKE_WIDTH} className={icon} />
                      {t('agent.share.download')}
                    </button>
                  </div>
                  <p className="text-xs text-ink-45">{t('agent.share.owner.hint')}</p>
                  <div className="min-w-0">
                    <label htmlFor={`report-copy-${listingId}`} className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
                      {t('agent.share.owner.captionLabel')}
                    </label>
                    <textarea
                      id={`report-copy-${listingId}`}
                      readOnly
                      value={report.caption}
                      rows={9}
                      className="u-focus-ring w-full resize-none rounded-lg border border-line bg-surface p-3 text-base leading-relaxed text-ink sm:text-sm"
                    />
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
