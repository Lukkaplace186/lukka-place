'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Download, MessageCircle, Share2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { buildWhatsAppShareLink } from '@/lib/whatsapp';
import { getListingShareKitAction } from '@/app/compte/agent/shareActions';
import { useToast } from './Toast';
import { useT } from '@/lib/i18n/client';

const BLOCKER_KEYS = {
  pending: 'agent.share.blocked.pending',
  rejected: 'agent.share.blocked.rejected',
  archived: 'agent.share.blocked.archived',
  under_offer: 'agent.share.blocked.underOffer',
  closed: 'agent.share.blocked.closed',
};

/**
 * "Visuel & partage" — the agent's one-tap marketing kit for a listing:
 * the square social graphic, the French caption, and the three ways agents
 * in Kinshasa actually push a listing out.
 *
 *   Partager l'image   Web Share with the PNG attached. On a phone that is the
 *                      system sheet → WhatsApp → "Mon statut" (or a broadcast
 *                      list, or a Facebook group). There is no web link that
 *                      posts to a WhatsApp Status directly — the share sheet
 *                      IS the one-tap path, so we copy the caption first and
 *                      say so, because WhatsApp drops text attached to an image
 *                      shared to Status.
 *   Envoyer sur        wa.me/?text= — WhatsApp's own contact / broadcast-list
 *   WhatsApp           picker, text only.
 *   Télécharger        for a desktop, or to post later.
 *
 * PHONE LAYOUT. All four actions sit directly under a reduced preview, before
 * the caption. They used to follow a full-width square preview and the
 * caption box, which put "Envoyer sur WhatsApp" below the fold of a 92vh
 * dialog on iPhone Safari — where `vh` includes the space the toolbar covers,
 * so the last button could not be reached at all. Height is `dvh` now and the
 * bottom padding clears the home indicator.
 *
 * Mounted as a SIBLING of the actions menu, never inside a menu item — see
 * AgentListingActionsMenu's note on Radix unmounting dialogs with the menu.
 */
export default function AgentListingShareKit({ listingId, open, onOpenChange }) {
  const t = useT();
  const { showToast } = useToast();
  const [kit, setKit] = useState(null);
  const [failed, setFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // A fresh image per opening: the price may have changed since the last one.
  const [stamp, setStamp] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    getListingShareKitAction(listingId)
      .then((result) => {
        if (cancelled) return;
        if (!result?.ok) setFailed(true);
        else setKit(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, listingId]);

  function handleOpenChange(next) {
    if (next) {
      setStamp(Date.now());
    } else {
      setKit(null);
      setFailed(false);
      setImageFailed(false);
      setCopied(false);
    }
    onOpenChange(next);
  }

  const imageSrc = `/compte/agent/biens/${listingId}/visuel?v=${stamp}`;
  const fileName = `lukka-place-bien-${listingId}.png`;

  async function copyCaption() {
    if (!kit?.copy) return false;
    try {
      await navigator.clipboard.writeText(kit.copy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return true;
    } catch {
      return false;
    }
  }

  async function fetchImageFile() {
    const res = await fetch(imageSrc, { cache: 'no-store' });
    if (!res.ok) throw new Error(`flyer ${res.status}`);
    const blob = await res.blob();
    return new File([blob], fileName, { type: 'image/png' });
  }

  function saveFile(file) {
    const href = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  async function handleShareImage() {
    setBusy(true);
    // Started before any await, while the tap still counts as a user gesture
    // for the clipboard in Safari.
    const captionCopied = copyCaption();
    try {
      const file = await fetchImageFile();
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: kit.copy });
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

  async function handleDownload() {
    setBusy(true);
    try {
      saveFile(await fetchImageFile());
    } catch {
      showToast({ type: 'error', message: t('agent.share.shareFailed') });
    } finally {
      setBusy(false);
    }
  }

  const shareable = kit?.shareable === true;
  const actionClass =
    'u-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-center text-[0.8125rem] font-bold leading-tight disabled:opacity-50 sm:gap-2 sm:px-4 sm:text-sm';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[88dvh] gap-3 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:gap-4">
        <DialogHeader>
          <DialogTitle>{t('agent.share.title')}</DialogTitle>
          <DialogDescription>{t('agent.share.description')}</DialogDescription>
        </DialogHeader>

        {failed && <p className="text-sm text-danger" role="alert">{t('agent.share.loadFailed')}</p>}
        {!kit && !failed && <p className="text-sm text-ink-45" role="status">{t('agent.share.loading')}</p>}

        {kit && !shareable && (
          <p className="rounded-lg bg-canvas-alt p-3 text-sm text-ink-70" role="status">
            {t(BLOCKER_KEYS[kit.blocker] || 'agent.share.blocked.pending')}
          </p>
        )}

        {shareable && (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="mx-auto aspect-square w-full max-w-[13.5rem] overflow-hidden rounded-xl border border-line bg-canvas-deep sm:max-w-full">
              {imageFailed ? (
                <p className="grid h-full place-items-center p-4 text-center text-xs text-ink-45">{t('agent.share.imageFailed')}</p>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageSrc}
                  alt={t('agent.share.previewAlt')}
                  className="h-full w-full object-cover"
                  onError={() => setImageFailed(true)}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={handleShareImage} disabled={busy || imageFailed} className={`${actionClass} u-btn-primary bg-blue text-white`}>
                <Share2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" />
                {busy ? t('agent.share.preparing') : t('agent.share.shareImage')}
              </button>
              <a
                href={buildWhatsAppShareLink(kit.copy)}
                target="_blank"
                rel="noopener noreferrer"
                className={`${actionClass} border border-line text-ink`}
              >
                <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-green-deep" />
                {t('agent.share.sendWhatsApp')}
              </a>
              <button type="button" onClick={handleDownload} disabled={busy || imageFailed} className={`${actionClass} border border-line text-ink`}>
                <Download strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" />
                {t('agent.share.download')}
              </button>
              <button type="button" onClick={copyCaption} className={`${actionClass} border border-line text-ink`}>
                {copied ? <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" /> : <Copy strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" />}
                {copied ? t('agent.share.copied') : t('agent.share.copyCaption')}
              </button>
            </div>
            <p className="text-xs text-ink-45">{t('agent.share.statusHint')}</p>

            <div className="min-w-0">
              <label htmlFor={`share-copy-${listingId}`} className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
                {t('agent.share.captionLabel')}
              </label>
              <textarea
                id={`share-copy-${listingId}`}
                readOnly
                value={kit.copy}
                rows={7}
                className="u-focus-ring w-full resize-none rounded-lg border border-line bg-surface p-3 text-base leading-relaxed text-ink sm:text-sm"
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
