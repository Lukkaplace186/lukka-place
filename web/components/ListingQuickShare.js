'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Share2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { buildListingShareMessage, buildWhatsAppShareLink } from '@/lib/whatsapp';
import { recordListingSharesAction } from '@/app/compte/agent/shareActions';
import { formatFileName } from '@/lib/marketing/formats';
import { prepareListingCard } from '@/lib/listingCardCache';
import { WhatsAppIcon } from './WhatsAppCTA';
import { useToast } from './Toast';
import { useT } from '@/lib/i18n/client';

/** The two cards this dialog draws: the WhatsApp square, and the 4:5 feed card. */
const FORMATS = ['square', 'feed'];

/**
 * Mes biens' "Partager sur WhatsApp" — the listing CARD with its caption, not
 * a bare link (2026-10-06, product direction: the branded image is the
 * standard share; a text message only unfurls into WhatsApp's small grey
 * link preview).
 *
 * Opens on the card itself, drawn in the browser (lib/marketing/layout.js →
 * CanvasRenderer) and usually drawn already — lib/listingCardCache.js warms
 * it while the agent scrolls Mes biens — then ONE button
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
 * THE 4:5 FEED CARD (2026-10-26, "Carte feed social"). A switch above the
 * preview draws the same listing as the Instagram / Facebook feed card
 * (`feed`, 1080×1350) from the same kit. Its caption is the kit's `social`
 * copy (no WhatsApp *bold*, hashtags at the end). It is posted from the
 * gallery as often as from the share sheet, so Télécharger and "Copier la
 * légende" sit beside Partager; there is no wa.me text link in that mode.
 *
 * Recorded as the share kit records an image (`kit_share` / `kit_download` ×
 * square or feed), the copied caption as `kit_copy` × text, and the text link
 * as before (`menu_whatsapp` × text). `feed` needs
 * migrations/20261026_listing_share_feed_format.sql; until it runs, a feed
 * share records nothing and the share itself is unaffected.
 *
 * `audience="team"` is the same dialog on /admin/listings/[id], where Lukka
 * Place makes the card for its own pages (TeamSocialCardButton): the 4:5 only,
 * drawn from the team's kit (any agent's live listing, the company's
 * utm_source), and nothing recorded in listing_shares, which counts what
 * agents did with their own listings.
 *
 * Mounted as a SIBLING of the actions menu (AgentListingActionsMenu), never
 * inside a menu item: Radix unmounts the menu content on close, which would
 * take the dialog with it.
 */
export default function ListingQuickShare({ listing, caption, open, onOpenChange, audience = 'agent', initialFormat = 'square' }) {
  const t = useT();
  const { showToast } = useToast();
  const team = audience === 'team';
  const formats = team ? ['feed'] : FORMATS;
  // Mes biens' "Publier sur les réseaux sociaux" opens straight on the 4:5.
  const startFormat = formats.includes(initialFormat) ? initialFormat : formats[0];
  const [format, setFormat] = useState(startFormat);
  const [state, setState] = useState({ status: 'idle' }); // idle (drawing) | ready | failed
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pageCopied, setPageCopied] = useState(false);
  const urlRef = useRef(null);
  const feed = format === 'feed';

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    // The square is usually already drawn: the share button warms it when it
    // scrolls into view, the row menu when it opens (lib/listingCardCache.js).
    // The 4:5 is drawn on demand from the same kit.
    prepareListingCard(listing, format, { audience }).then((result) => {
      if (cancelled) return;
      if (result.status !== 'ready') {
        setState({ status: 'failed', kit: result.kit });
        return;
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(result.blob);
      setState({ status: 'ready', kit: result.kit, blob: result.blob, url: urlRef.current });
    });
    return () => {
      cancelled = true;
    };
  }, [open, listing, format, audience]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const kit = state.kit;
  // The caption that goes with the image carries the image's utm_source; the
  // text-only link keeps the one the old button sent.
  const imageCaption = (feed ? kit?.copies?.social : null) || kit?.copies?.image || caption || '';
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
  const file = state.status === 'ready' ? new File([state.blob], formatFileName(listing.id, format), { type: 'image/jpeg' }) : null;
  const canShareFile = Boolean(file && typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] }));

  const record = (channel, recordFormat) => {
    if (team) return;
    recordListingSharesAction({ listingIds: [listing.id], channel, format: recordFormat }).catch(() => {});
  };

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
      record('kit_share', format);
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
    record('kit_download', format);
    showToast({ type: 'success', message: t('agent.share.downloadedInstead') });
  }

  async function copyOnly() {
    if (await copyCaption()) record('kit_copy', 'text');
  }

  // The agent's own page, for their Instagram / TikTok bio (kit.agentPage).
  function copyPageLink() {
    const url = kit?.agentPage?.url;
    if (!url) return;
    navigator.clipboard
      .writeText(url)
      .then(() => setPageCopied(true))
      .catch(() => showToast({ type: 'error', message: t('agent.quickShare.myPageCopyFailed') }));
  }

  function chooseFormat(next) {
    if (next === format) return;
    setState({ status: 'idle' });
    setCopied(false);
    setFormat(next);
  }

  const primary =
    'u-press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-[0.9375rem] font-bold disabled:opacity-60';
  const secondary =
    'u-press inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold text-ink ring-1 ring-inset ring-ink-25 hover:bg-canvas-alt disabled:opacity-60';

  // Reset on close, so the next opening starts from the spinner rather than
  // the previous listing's card, and on the square.
  function handleOpenChange(next) {
    if (!next) {
      setState({ status: 'idle' });
      setCopied(false);
      setPageCopied(false);
      setFormat(startFormat);
    }
    onOpenChange(next);
  }

  const shareButton = feed ? (
    <button type="button" onClick={share} disabled={!canShareFile || busy} className={`${primary} u-btn-primary bg-blue text-white hover:bg-blue-deep`}>
      <Share2 className="h-5 w-5 shrink-0" aria-hidden="true" />
      {t('agent.quickShare.shareFeed')}
    </button>
  ) : (
    <button type="button" onClick={share} disabled={!canShareFile || busy} className={`${primary} bg-green-ink text-white hover:bg-green-deep`}>
      <WhatsAppIcon className="h-5 w-5 shrink-0" />
      {t('agent.quickShare.share')}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-3 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{feed ? t('agent.quickShare.titleFeed') : t('agent.quickShare.title')}</DialogTitle>
          <DialogDescription>
            {team ? t('agent.quickShare.descriptionTeam') : feed ? t('agent.quickShare.descriptionFeed') : t('agent.quickShare.description')}
          </DialogDescription>
        </DialogHeader>

        {formats.length > 1 ? (
          <div role="group" aria-label={t('agent.quickShare.formatLabel')} className="grid grid-cols-2 gap-1 rounded-xl bg-canvas-alt p-1">
            {formats.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={format === key}
                onClick={() => chooseFormat(key)}
                className={`min-h-11 rounded-lg px-2 text-[0.8125rem] font-bold transition-colors ${
                  format === key ? 'bg-surface text-ink shadow-sm' : 'text-ink-70 hover:text-ink'
                }`}
              >
                {t(`agent.quickShare.formats.${key}`)}
              </button>
            ))}
          </div>
        ) : null}

        <div
          className={`mx-auto w-full overflow-hidden rounded-xl bg-blue ${feed ? 'aspect-[4/5] max-w-[15.5rem]' : 'aspect-square max-w-[19rem]'}`}
        >
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
          {state.status !== 'failed' && (canShareFile || state.status !== 'ready' ? shareButton : (
            <button type="button" onClick={download} className={`${primary} bg-ink text-white`}>
              <Download className="h-5 w-5 shrink-0" aria-hidden="true" />
              {t('agent.quickShare.download')}
            </button>
          ))}
          {feed ? (
            <div className={`grid gap-2 ${canShareFile ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {canShareFile ? (
                <button type="button" onClick={download} className={secondary}>
                  <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {t('agent.quickShare.downloadShort')}
                </button>
              ) : null}
              <button type="button" onClick={copyOnly} disabled={!imageCaption} className={secondary}>
                {copied ? <Check className="h-4 w-4 shrink-0 text-green-ink" aria-hidden="true" /> : <Copy className="h-4 w-4 shrink-0" aria-hidden="true" />}
                {copied ? t('agent.quickShare.captionCopiedShort') : t('agent.quickShare.copyCaption')}
              </button>
            </div>
          ) : (
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
          )}
          <p className="text-center text-[0.8125rem] leading-snug text-ink-45" role="status">
            {copied ? t('agent.share.captionCopied') : feed ? t('agent.quickShare.hintFeed') : t('agent.quickShare.hint')}
          </p>
        </div>

        {feed && !team && kit?.agentPage ? (
          <div className="rounded-xl bg-canvas-alt p-3">
            <p className="u-title-sub text-ink">{t('agent.quickShare.myPageTitle')}</p>
            <p className="u-micro mt-0.5 text-ink-70">{t('agent.quickShare.myPageHint')}</p>
            <div className="mt-2 flex items-center gap-2">
              <a
                href={kit.agentPage.url}
                target="_blank"
                rel="noopener noreferrer"
                className="u-micro-strong min-w-0 flex-1 truncate text-blue-deep hover:underline"
              >
                {kit.agentPage.label}
              </a>
              <button type="button" onClick={copyPageLink} className={`${secondary} min-h-10 shrink-0 bg-surface`}>
                {pageCopied ? <Check className="h-4 w-4 shrink-0 text-green-ink" aria-hidden="true" /> : <Copy className="h-4 w-4 shrink-0" aria-hidden="true" />}
                {pageCopied ? t('agent.quickShare.myPageCopied') : t('agent.quickShare.myPageCopy')}
              </button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
