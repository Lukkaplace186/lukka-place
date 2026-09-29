'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BarChart3, Check, Copy, MessageCircle } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { createReportLinkAction } from '@/app/compte/agent/reportLinkActions';
import { ownerReportMessage } from '@/lib/marketing/liveReportCopy';

/**
 * The owner's live report link inside the share kit's "Propriétaire" tab.
 * One tap creates the link (or returns the existing one — the action is
 * idempotent, ownership in its SQL) and copies it; the URL stays on screen
 * so it can still be copied by hand when the browser refuses the clipboard
 * after the round trip. Revoking and replacing live on the listing page
 * (ReportLinkCard), linked below.
 */
export default function ReportLinkQuick({ listingId }) {
  const t = useT();
  const [state, setState] = useState({ status: 'idle', url: null });
  const [copied, setCopied] = useState(false);

  async function ensureLink() {
    if (state.url) return state.url;
    setState({ status: 'loading', url: null });
    try {
      const result = await createReportLinkAction(listingId);
      if (result?.ok && result.link?.url) {
        setState({ status: 'ready', url: result.link.url });
        return result.link.url;
      }
      setState({ status: result?.reason === 'unavailable' ? 'unavailable' : 'failed', url: null });
    } catch {
      setState({ status: 'failed', url: null });
    }
    return null;
  }

  async function copy() {
    const url = await ensureLink();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The URL is shown below; the agent can copy it by hand.
    }
  }

  const action = 'u-press inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold';

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-line p-3">
      <p className="u-micro-strong flex items-center gap-1.5 text-ink">
        <BarChart3 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-blue-deep" aria-hidden="true" />
        {t('agent.share.owner.liveTitle')}
      </p>
      <p className="text-xs text-ink-70">{t('agent.share.owner.liveHint')}</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={copy} disabled={state.status === 'loading'} className={`${action} border border-line text-ink`}>
          {copied ? <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-green-deep" /> : <Copy strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />}
          {copied ? t('agent.share.owner.liveCopied') : t('agent.share.owner.liveCopy')}
        </button>
        {state.url ? (
          <a
            href={`https://wa.me/?text=${encodeURIComponent(ownerReportMessage(state.url))}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`${action} border border-line text-ink`}
          >
            <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-green-deep" />
            {t('agent.share.owner.liveSend')}
          </a>
        ) : (
          <button type="button" onClick={ensureLink} disabled={state.status === 'loading'} className={`${action} border border-line text-ink`}>
            <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-green-deep" />
            {t('agent.share.owner.liveSend')}
          </button>
        )}
      </div>
      {state.url ? (
        <input
          readOnly
          value={state.url}
          onFocus={(e) => e.target.select()}
          aria-label={t('agent.share.owner.liveTitle')}
          className="u-focus-ring w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-base text-ink sm:text-xs"
        />
      ) : null}
      {state.status === 'unavailable' ? <p className="text-xs text-ink-70" role="alert">{t('agent.share.owner.liveUnavailable')}</p> : null}
      {state.status === 'failed' ? <p className="text-xs text-danger" role="alert">{t('agent.share.owner.liveFailed')}</p> : null}
      <Link href={`/compte/agent/biens/${listingId}`} className="text-xs font-semibold text-blue-deep hover:underline">
        {t('agent.share.owner.liveManage')}
      </Link>
    </div>
  );
}
