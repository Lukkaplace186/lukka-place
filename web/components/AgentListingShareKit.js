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
 *   Télécharger        for a desktop, or to post later.
 *   Envoyer le lien    wa.me/?text= — WhatsApp's own contact / broadcast-list
 *                      picker, text only.
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
    'u-press inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold disabled:opacity-50';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
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
          <div className="flex flex-col gap-4">
            <div className="aspect-square w-full max-w-full overflow-hidden rounded-xl border border-line bg-canvas-deep">
              {imageFailed ? (
                <p className="grid h-full place-items-center p-6 text-center text-sm text-ink-45">{t('agent.share.imageFailed')}</p>
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

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" onClick={handleShareImage} disabled={busy || imageFailed} className={`${actionClass} u-btn-primary bg-blue text-white`}>
                <Share2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                {busy ? t('agent.share.preparing') : t('agent.share.shareImage')}
              </button>
              <button type="button" onClick={handleDownload} disabled={busy || imageFailed} className={`${actionClass} u-btn-secondary text-ink`}>
                <Download strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                {t('agent.share.download')}
              </button>
            </div>
            <p className="text-xs text-ink-45">{t('agent.share.statusHint')}</p>

            <div>
              <label htmlFor={`share-copy-${listingId}`} className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
                {t('agent.share.captionLabel')}
              </label>
              <textarea
                id={`share-copy-${listingId}`}
                readOnly
                value={kit.copy}
                rows={8}
                className="u-focus-ring w-full resize-none rounded-lg border border-line bg-surface p-3 text-sm leading-relaxed text-ink"
              />
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button type="button" onClick={copyCaption} className={`${actionClass} border border-line text-ink`}>
                  {copied ? <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" /> : <Copy strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />}
                  {copied ? t('agent.share.copied') : t('agent.share.copyCaption')}
                </button>
                <a
                  href={buildWhatsAppShareLink(kit.copy)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${actionClass} border border-line text-ink`}
                >
                  <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                  {t('agent.share.sendWhatsApp')}
                </a>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
