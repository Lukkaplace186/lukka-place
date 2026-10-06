'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BarChart3, ChevronRight, Download, FileText, MessageCircle, Printer, Share2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { buildWhatsAppShareLink } from '@/lib/whatsapp';
import { getMandateReportAction } from '@/app/compte/agent/shareActions';
import { fetchPackImages } from '@/lib/sharePack';
import { decodeAssets, loadRenderFont, renderReport } from './marketing/CanvasRenderer';
import { useToast } from './Toast';
import ReportLinkQuick from './ReportLinkQuick';
import { useT } from '@/lib/i18n/client';

const BLOCKER_KEYS = {
  pending: 'agent.share.blocked.pending',
  rejected: 'agent.share.blocked.rejected',
  archived: 'agent.share.blocked.archived',
  under_offer: 'agent.share.blocked.underOffer',
  closed: 'agent.share.blocked.closed',
};

function releaseAssets(assets) {
  for (const image of Object.values(assets?.images || {})) image?.close?.();
}

/**
 * "Documents et rapports" (2026-10-06, product direction: the Marketing &
 * Documents dialog had become redundant with "Partager sur WhatsApp",
 * ListingQuickShare, which now sends the listing card and its caption). What
 * is left is what the share does not do:
 *
 *   Documents A4          the window poster and the technical sheet — links
 *                         to their print pages (…/affiche, …/fiche).
 *   Rapport propriétaire  the owner's report since the listing went online
 *                         (all-time, no longer "the last 7 days"): live counts
 *                         from the server, card drawn in the browser, caption
 *                         that says what the counts cover and what they do not,
 *                         plus the live report link.
 *
 * Gone from here: the listing graphic (square / 9:16), "Photos avec mon logo"
 * and the listing text. The dialog no longer loads a share pack at all, so it
 * opens instantly.
 *
 * `blocker` is shareBlocker(listing) from the caller: the print pages carry a
 * QR code and a link to the public page, so they are offered only for a live
 * listing; the report works in any state.
 *
 * Mounted as a SIBLING of the actions menu, never inside a menu item — see
 * AgentListingActionsMenu's note on Radix unmounting dialogs with the menu.
 */
export default function AgentListingShareKit({ listingId, blocker = null, open, onOpenChange }) {
  const t = useT();
  const { showToast } = useToast();
  const [view, setView] = useState('home'); // 'home' | 'owner'
  const [report, setReport] = useState({ status: 'idle' });
  const [busy, setBusy] = useState(false);
  const reportUrlRef = useRef(null);

  const reset = useCallback(() => {
    if (reportUrlRef.current) URL.revokeObjectURL(reportUrlRef.current);
    reportUrlRef.current = null;
    setReport({ status: 'idle' });
    setView('home');
  }, []);

  useEffect(() => reset, [reset]);

  function handleOpenChange(next) {
    if (!next) reset();
    onOpenChange(next);
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

  const reportFile = () => new File([report.blob], `lukka-place-rapport-${listingId}.jpg`, { type: 'image/jpeg' });

  async function shareReport() {
    setBusy(true);
    // Started inside the tap, while it still counts as a user gesture for the
    // clipboard in Safari.
    const copied = navigator.clipboard?.writeText(report.caption).then(() => true, () => false) ?? Promise.resolve(false);
    try {
      const file = reportFile();
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: report.caption });
        if (await copied) showToast({ type: 'success', message: t('agent.share.captionCopied') });
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
      const [family, loaded] = await Promise.all([loadRenderFont(), decodeAssets(images)]);
      decoded = loaded;
      const { blob } = await renderReport(result.report, loaded, family);
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

  const printable = !blocker;
  const actionClass =
    'u-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-center text-[0.8125rem] font-bold leading-tight disabled:opacity-50 sm:gap-2 sm:px-4 sm:text-sm';
  const icon = 'h-4 w-4 shrink-0';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[88dvh] gap-3 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:gap-4">
        <DialogHeader>
          {view !== 'home' && (
            <button
              type="button"
              onClick={() => setView('home')}
              className="u-press -ml-1 mb-1 inline-flex min-h-9 items-center gap-1 self-start rounded-lg px-1 text-[0.8125rem] font-semibold text-ink-70 hover:text-ink"
            >
              <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('agent.share.title')}
            </button>
          )}
          <DialogTitle>{view === 'owner' ? t('agent.share.rows.owner') : t('agent.share.title')}</DialogTitle>
          <DialogDescription className={view === 'home' ? '' : 'sr-only'}>{t('agent.share.description')}</DialogDescription>
        </DialogHeader>

        {view === 'home' && (
          <div className="flex min-w-0 flex-col gap-4">
            <KitSection title={t('agent.share.sections.print')}>
              {!printable && (
                <p className="bg-canvas-alt p-3 text-sm text-ink-70" role="status">
                  {t(BLOCKER_KEYS[blocker] || 'agent.share.blocked.pending')}
                </p>
              )}
              <KitRow
                icon={Printer}
                title={t('agent.print.posterMenuItem')}
                hint={t('agent.share.rows.posterHint')}
                href={`/compte/agent/biens/${listingId}/affiche`}
                disabled={!printable}
              />
              <KitRow
                icon={FileText}
                title={t('agent.print.sheetMenuItem')}
                hint={t('agent.share.rows.sheetHint')}
                href={`/compte/agent/biens/${listingId}/fiche`}
                disabled={!printable}
              />
            </KitSection>

            <KitSection title={t('agent.share.sections.owner')}>
              <KitRow icon={BarChart3} title={t('agent.share.rows.owner')} hint={t('agent.share.rows.ownerHint')} onClick={() => setView('owner')} />
            </KitSection>
          </div>
        )}

        {view === 'owner' && (
          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-sm text-ink-70">{t('agent.share.owner.intro')}</p>

            <ReportLinkQuick listingId={listingId} />

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
                  <button type="button" onClick={shareReport} disabled={busy} className={`${actionClass} u-btn-primary col-span-2 bg-blue text-white`}>
                    <Share2 strokeWidth={ICON_STROKE_WIDTH} className={icon} />
                    {busy ? t('agent.share.preparing') : t('agent.share.owner.share')}
                  </button>
                  <a href={buildWhatsAppShareLink(report.caption)} target="_blank" rel="noopener noreferrer" className={`${actionClass} border border-line text-ink`}>
                    <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className={`${icon} text-green-deep`} />
                    {t('agent.share.sendWhatsApp')}
                  </a>
                  <button type="button" onClick={() => saveFile(reportFile())} disabled={busy} className={`${actionClass} border border-line text-ink`}>
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function KitSection({ title, children }) {
  return (
    <section className="min-w-0">
      <h3 className="u-micro-strong mb-1.5 px-0.5 uppercase tracking-wide text-ink-45">{title}</h3>
      <div className="overflow-hidden rounded-xl border border-line [&>*+*]:border-t [&>*+*]:border-line">{children}</div>
    </section>
  );
}

/**
 * One tool in the home list: drills into a view (`onClick`) or opens a print
 * page (`href`). A disabled row stays visible — the section's note says why —
 * so an agent learns the tool exists before their listing is live.
 */
function KitRow({ icon: Icon, title, hint, onClick, href, disabled = false }) {
  const inner = (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-tint text-blue">
        <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-ink">{title}</span>
        {hint && <span className="block text-xs text-ink-45">{hint}</span>}
      </span>
      <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-25" aria-hidden="true" />
    </>
  );
  const rowClass = 'u-press flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-canvas-alt';
  if (disabled) {
    return (
      <div className={`${rowClass} pointer-events-none opacity-50`} aria-disabled="true">
        {inner}
      </div>
    );
  }
  if (href) {
    return (
      <Link href={href} className={rowClass}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={rowClass}>
      {inner}
    </button>
  );
}
