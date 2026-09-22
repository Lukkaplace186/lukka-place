'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, RefreshCw, Share2, Smartphone } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { formatPrice } from '@/lib/format';
import { LISTING_TIME_ZONE } from '@/lib/listingView';
import { formatFileName } from '@/lib/marketing/formats';
import { fetchPackImages } from '@/lib/sharePack';
import { getStatusPacksAction, recordListingSharesAction } from '@/app/compte/agent/shareActions';
import { decodeAssets, loadRenderFont, renderFlyer } from './marketing/CanvasRenderer';
import { useToast } from './Toast';
import { useLocale, useT } from '@/lib/i18n/client';

function releaseAssets(assets) {
  for (const image of Object.values(assets?.images || {})) image?.close?.();
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

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * "Statut du jour" — the overview card that turns today's WhatsApp Status
 * into one tap: up to five live listings the agent has not shared lately
 * (lib/listingShares.js getStatusSuggestions — never shared first, then least
 * recently, newest first), drawn as 9:16 Status images in the browser with the
 * share kit's own renderer and share pack, then shared together through the
 * phone's share sheet or downloaded.
 *
 * Same fallbacks as AgentListingShareKit: Web Share with files where the
 * browser can (`canShare({files})`), a download otherwise. A cancelled share
 * sheet records nothing; a completed share or a download records one row per
 * listing (listing_shares), fire-and-forget. Images are drawn on demand, not
 * on page load — five photos at 1080px is real data on a prepaid phone.
 */
export default function AgentStatusOfTheDay({ items, tracked, liveCount, recentDays }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { showToast } = useToast();
  const [phase, setPhase] = useState('idle'); // idle | preparing | ready | failed | offline
  const [images, setImages] = useState([]); // { id, title, file, url }
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);
  const urlsRef = useRef([]);

  useEffect(
    () => () => {
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const dateFormat = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: LISTING_TIME_ZONE,
  });

  async function prepare() {
    setPhase('preparing');
    let result;
    try {
      result = await getStatusPacksAction(items.map((item) => item.id));
    } catch {
      setPhase('offline');
      return;
    }
    if (!result?.ok || !result.kits.length) {
      setPhase('failed');
      return;
    }
    const family = await loadRenderFont();
    const drawn = [];
    for (const kit of result.kits) {
      let assets = null;
      try {
        assets = await decodeAssets(await fetchPackImages(kit.pack));
        const { blob } = await renderFlyer(kit.pack, 'story', assets, family);
        const file = new File([blob], formatFileName(kit.pack.listingId, 'story'), { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        urlsRef.current.push(url);
        const title = items.find((item) => item.id === kit.pack.listingId)?.title || kit.pack.facts || '';
        drawn.push({ id: kit.pack.listingId, title, file, url });
      } catch {
        // One listing that cannot be drawn does not cost the others theirs.
      } finally {
        releaseAssets(assets);
      }
    }
    setSkipped(items.length - drawn.length);
    setImages(drawn);
    setPhase(drawn.length ? 'ready' : 'failed');
  }

  function record(ids, channel) {
    recordListingSharesAction({ listingIds: ids, channel, format: 'story' }).catch(() => {});
  }

  async function share(selection) {
    const files = selection.map((image) => image.file);
    setBusy(true);
    try {
      if (navigator.canShare?.({ files })) {
        await navigator.share({ files });
        record(selection.map((image) => image.id), 'status_share');
      } else {
        await downloadFiles(selection);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') showToast({ type: 'error', message: t('agent.status.shareFailed') });
    } finally {
      setBusy(false);
    }
  }

  async function downloadFiles(selection) {
    for (const image of selection) {
      saveFile(image.file);
      // Browsers drop back-to-back programmatic downloads; a short gap lets each through.
      await pause(350);
    }
    record(selection.map((image) => image.id), 'status_download');
    showToast({ type: 'success', message: t('agent.status.downloaded') });
  }

  async function downloadAll() {
    setBusy(true);
    try {
      await downloadFiles(images);
    } finally {
      setBusy(false);
    }
  }

  const actionClass =
    'u-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-center text-[0.8125rem] font-bold leading-tight disabled:opacity-50 sm:text-sm';
  const icon = 'h-4 w-4 shrink-0';

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6" aria-labelledby="status-of-the-day-title">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-tint text-blue">
          <Smartphone strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 id="status-of-the-day-title" className="u-title-card text-ink">
            {t('agent.status.title')}
          </h2>
          <p className="u-micro mt-0.5 text-ink-45">{t('agent.status.intro', { days: recentDays })}</p>
        </div>
      </div>

      {liveCount === 0 && (
        <p className="mt-4 rounded-lg bg-canvas-alt p-3 text-sm text-ink-70" role="status">
          {t('agent.status.emptyNoLive')}{' '}
          <Link href="/compte/agent/biens" className="font-semibold text-blue-deep underline-offset-2 hover:underline">
            {t('agent.status.openListings')}
          </Link>
        </p>
      )}
      {liveCount > 0 && items.length === 0 && (
        <p className="mt-4 rounded-lg bg-canvas-alt p-3 text-sm text-ink-70" role="status">
          {t('agent.status.emptyAllShared', { days: recentDays })}
        </p>
      )}

      {items.length > 0 && phase !== 'ready' && (
        <>
          <ul className="mt-4 flex flex-col divide-y divide-line">
            {items.map((item) => (
              <li key={item.id} className="flex min-w-0 items-baseline justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="u-micro-strong truncate text-ink">{item.title || [item.quartier, item.commune].filter(Boolean).join(', ')}</p>
                  <p className="u-micro text-ink-45">
                    {item.lastSharedAt
                      ? t('agent.status.lastShared', { date: dateFormat.format(new Date(item.lastSharedAt)) })
                      : tracked
                        ? t('agent.status.neverShared')
                        : [item.quartier, item.commune].filter(Boolean).join(', ')}
                  </p>
                </div>
                <span className="u-micro-strong u-tabular shrink-0 text-ink">{formatPrice(item.price, item.purpose, item.price_period)}</span>
              </li>
            ))}
          </ul>
          {!tracked && <p className="u-micro mt-2 text-ink-45">{t('agent.status.untracked')}</p>}
          <button
            type="button"
            onClick={prepare}
            disabled={phase === 'preparing'}
            className={`${actionClass} u-btn-primary mt-3 w-full bg-blue text-white`}
          >
            <Smartphone strokeWidth={ICON_STROKE_WIDTH} className={icon} />
            {phase === 'preparing' ? t('agent.status.preparing') : t('agent.status.prepare', { count: items.length })}
          </button>
          {phase === 'failed' && <p className="mt-2 text-sm text-danger" role="alert">{t('agent.status.failed')}</p>}
          {phase === 'offline' && <p className="mt-2 text-sm text-ink-70" role="alert">{t('agent.status.offline')}</p>}
        </>
      )}

      {phase === 'ready' && (
        <>
          <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {images.map((image) => (
              <li key={image.id} className="flex min-w-0 flex-col gap-1.5">
                <div className="aspect-[9/16] w-full overflow-hidden rounded-lg border border-line bg-canvas-deep">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt={t('agent.status.previewAlt', { title: image.title })} className="h-full w-full object-cover" />
                </div>
                <button
                  type="button"
                  onClick={() => share([image])}
                  disabled={busy}
                  className={`${actionClass} border border-line px-1.5 text-ink`}
                >
                  <Share2 strokeWidth={ICON_STROKE_WIDTH} className={icon} />
                  {t('agent.status.shareOne')}
                </button>
              </li>
            ))}
          </ul>
          {skipped > 0 && <p className="u-micro mt-2 text-ink-45">{t('agent.status.someSkipped')}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => share(images)} disabled={busy} className={`${actionClass} u-btn-primary bg-blue text-white`}>
              <Share2 strokeWidth={ICON_STROKE_WIDTH} className={icon} />
              {t('agent.status.shareAll')}
            </button>
            <button type="button" onClick={downloadAll} disabled={busy} className={`${actionClass} border border-line text-ink`}>
              <Download strokeWidth={ICON_STROKE_WIDTH} className={icon} />
              {t('agent.status.downloadAll')}
            </button>
          </div>
          <p className="u-micro mt-2 text-ink-45">{t('agent.status.hint')}</p>
          <button
            type="button"
            onClick={() => {
              setPhase('idle');
              setImages([]);
              router.refresh();
            }}
            className="u-press mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-[0.8125rem] font-semibold text-blue-deep hover:bg-canvas-alt"
          >
            <RefreshCw strokeWidth={ICON_STROKE_WIDTH} className={icon} />
            {t('agent.status.refresh')}
          </button>
        </>
      )}
    </section>
  );
}
