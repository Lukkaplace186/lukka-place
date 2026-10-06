'use client';

import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { buildListingShareMessage, buildWhatsAppShareLink } from '@/lib/whatsapp';
import { getSharePackAction, recordListingSharesAction } from '@/app/compte/agent/shareActions';
import { formatFileName } from '@/lib/marketing/formats';
import { fetchPackImages, loadSharePack, saveSharePack } from '@/lib/sharePack';
import { decodeAssets, loadRenderFont, renderFlyer } from './marketing/CanvasRenderer';
import { WhatsAppIcon } from './WhatsAppCTA';
import { useToast } from './Toast';
import { useT } from '@/lib/i18n/client';

const FORMAT = 'square';

/**
 * Mes biens' "Partager sur WhatsApp" — the listing CARD with its caption, not
 * a bare link (2026-10-06, product direction: the branded image is the
 * standard share; a text message only unfurls into WhatsApp's small grey
 * link preview).
 *
 * Opens on the card itself, drawn in the browser exactly as the share kit
 * draws its square (lib/marketing/layout.js → CanvasRenderer), then ONE button
 * hands the JPEG and the caption to the phone's share sheet → WhatsApp → a
 * chat, a group or "Mon statut". The image is ready BEFORE that tap, which is
 * what keeps iPhone Safari's share sheet working: `navigator.share` must run
 * inside the tap, with no network wait in front of it.
 *
 * The caption is copied to the clipboard in the same tap, because WhatsApp
 * drops text shared with an image to a Status, and some Android builds drop
 * it in chats too; the hint says to paste it.
 *
 * Where a browser cannot share files (most desktops), the card downloads
 * instead and "Envoyer le texte seulement" stays a real wa.me link, as the
 * old one-tap button was. Offline, the copy the share kit stored on this
 * phone is used (lib/sharePack.js); with none, only the text link works.
 *
 * Recorded as the share kit records an image (`kit_share` / `kit_download` ×
 * square) and the text link as before (`menu_whatsapp` × text), so
 * listing_shares needed no new CHECK value.
 *
 * Mounted as a SIBLING of the actions menu (AgentListingActionsMenu), never
 * inside a menu item: Radix unmounts the menu content on close, which would
 * take the dialog with it.
 */
export default function ListingQuickShare({ listing, caption, open, onOpenChange }) {
  const t = useT();
  const { showToast } = useToast();
  const [state, setState] = useState({ status: 'idle' }); // idle (drawing) | ready | failed
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const urlRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    let assets = null;

    (async () => {
      let kit = null;
      let blobs = null;
      try {
        const result = await getSharePackAction(listing.id);
        if (result?.ok) {
          kit = result;
          blobs = await fetchPackImages(result.pack, { signal: controller.signal });
          if (blobs.photos.length || !result.pack.photos.length) saveSharePack(listing.id, { kit: result, ...blobs });
        } else if (result) {
          // "Not yours" / gone: never papered over with a stored copy.
          if (!cancelled) setState({ status: 'failed' });
          return;
        }
      } catch (err) {
        if (err?.name === 'AbortError' || cancelled) return;
      }
      if (!kit) {
        const stored = await loadSharePack(listing.id);
        if (stored) {
          kit = stored.kit;
          blobs = { photos: stored.photos || [], logo: stored.logo || null, mark: stored.mark || null, markLight: stored.markLight || null };
        }
      }
      if (cancelled) return;
      if (!kit?.shareable || !blobs) {
        setState({ status: 'failed', kit });
        return;
      }
      try {
        const [family, decoded] = await Promise.all([loadRenderFont(), decodeAssets(blobs)]);
        assets = decoded;
        if (cancelled) return;
        const { blob } = await renderFlyer(kit.pack, FORMAT, decoded, family);
        if (cancelled) return;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(blob);
        setState({ status: 'ready', kit, blob, url: urlRef.current });
      } catch {
        if (!cancelled) setState({ status: 'failed', kit });
      } finally {
        for (const image of Object.values(assets?.images || {})) image?.close?.();
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, listing.id]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const kit = state.kit;
  // The caption that goes with the image carries the image's utm_source; the
  // text-only link keeps the one the old button sent.
  const imageCaption = kit?.copies?.image || caption || '';
  const textCaption =
    kit?.copies?.whatsapp ||
    caption ||
    buildListingShareMessage({
      title: listing.title,
      price: listing.price,
      purpose: listing.purpose,
      pricePeriod: listing.price_period,
      id: listing.id,
    });
  const file = state.status === 'ready' ? new File([state.blob], formatFileName(listing.id, FORMAT), { type: 'image/jpeg' }) : null;
  const canShareFile = Boolean(file && typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] }));

  const record = (channel, format) => recordListingSharesAction({ listingIds: [listing.id], channel, format }).catch(() => {});

  function copyCaption() {
    if (!imageCaption) return Promise.resolve(false);
    return navigator.clipboard
      .writeText(imageCaption)
      .then(() => {
        setCopied(true);
        return true;
      })
      .catch(() => false);
  }

  async function share() {
    if (!file) return;
    setBusy(true);
    // Both started inside the tap: the clipboard and the share sheet each
    // need the user gesture in Safari.
    const captionCopied = copyCaption();
    try {
      await navigator.share({ files: [file], text: imageCaption });
      record('kit_share', FORMAT);
      if (await captionCopied) showToast({ type: 'success', message: t('agent.share.captionCopied') });
      handleOpenChange(false);
    } catch (err) {
      if (err?.name !== 'AbortError') showToast({ type: 'error', message: t('agent.share.shareFailed') });
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!file) return;
    copyCaption();
    const href = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = href;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    record('kit_download', FORMAT);
    showToast({ type: 'success', message: t('agent.share.downloadedInstead') });
  }

  const primary =
    'u-press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-[0.9375rem] font-bold disabled:opacity-60';

  // Reset on close, so the next opening starts from the spinner rather than
  // the previous listing's card.
  function handleOpenChange(next) {
    if (!next) {
      setState({ status: 'idle' });
      setCopied(false);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-3 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('agent.quickShare.title')}</DialogTitle>
          <DialogDescription>{t('agent.quickShare.description')}</DialogDescription>
        </DialogHeader>

        <div className="mx-auto aspect-square w-full max-w-[19rem] overflow-hidden rounded-xl bg-blue">
          {state.status === 'ready' ? (
            // A blob URL the browser just drew; next/image has nothing to optimise.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={state.url} alt={t('agent.share.previewAlt')} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center px-6 text-center text-sm font-semibold text-white/85">
              {state.status === 'failed' ? t('agent.quickShare.imageFailed') : (
                <span className="flex flex-col items-center gap-3">
                  <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/30 border-t-white motion-reduce:animate-none" aria-hidden="true" />
                  {t('agent.quickShare.preparing')}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {state.status !== 'failed' && (canShareFile || state.status !== 'ready' ? (
            <button
              type="button"
              onClick={share}
              disabled={!canShareFile || busy}
              className={`${primary} bg-green-ink text-white hover:bg-green-deep`}
            >
              <WhatsAppIcon className="h-5 w-5 shrink-0" />
              {t('agent.quickShare.share')}
            </button>
          ) : (
            <button type="button" onClick={download} className={`${primary} bg-ink text-white`}>
              <Download className="h-5 w-5 shrink-0" aria-hidden="true" />
              {t('agent.quickShare.download')}
            </button>
          ))}
          <a
            href={buildWhatsAppShareLink(textCaption)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              record('menu_whatsapp', 'text');
              handleOpenChange(false);
            }}
            className="u-press inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-bold text-green-ink ring-1 ring-inset ring-ink-25 hover:bg-canvas-alt"
          >
            {t('agent.quickShare.textOnly')}
          </a>
          <p className="text-center text-[0.8125rem] leading-snug text-ink-45" role="status">
            {copied ? t('agent.share.captionCopied') : t('agent.quickShare.hint')}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
