'use client';

import { useState, useTransition } from 'react';
import { Check, Copy, Link2, MessageCircle, RefreshCw } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { useToast } from './Toast';
import { createReportLinkAction, revokeReportLinkAction } from '@/app/compte/agent/reportLinkActions';

/**
 * The owner's live report link on the agent's listing page: create it once,
 * copy it or send it on WhatsApp, see whether the owner opened it, replace it
 * to cut off an old link.
 *
 * The WhatsApp message is French whatever the UI language — it is read by the
 * landlord, the same rule as every forwarded text (lib/listingShareCopy.js).
 * It opens the agent's OWN WhatsApp with no recipient, so they pick the owner
 * from their contacts; Lukka Place never messages the owner.
 */

function ownerMessage(url) {
  return `Bonjour, voici le rapport en direct de votre bien sur Lukka Place : vues, personnes intéressées, appels, messages et demandes de visite, toujours à jour.\n${url}`;
}

export default function ReportLinkCard({ propertyId, initialLink, available }) {
  const t = useT();
  const { showToast } = useToast();
  const [link, setLink] = useState(initialLink);
  const [copied, setCopied] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(action) {
    startTransition(async () => {
      const result = await action();
      if (result?.ok && result.link) {
        setLink(result.link);
        setConfirmReplace(false);
      } else if (result?.ok === true) {
        setLink(null);
      } else {
        showToast({
          type: 'error',
          message: result?.reason === 'unavailable' ? t('agent.hub.report.unavailable') : t('agent.hub.report.error'),
        });
      }
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast({ type: 'error', message: t('agent.hub.report.error') });
    }
  }

  const openedText = link?.viewCount
    ? t('agent.hub.report.views', {
        count: link.viewCount,
        date: link.lastViewedAt ? new Date(link.lastViewedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '',
      })
    : t('agent.hub.report.notViewed');

  return (
    <section className="u-card flex flex-col gap-3 rounded-card bg-surface p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-tint text-blue">
          <Link2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="u-title-card text-ink">{t('agent.hub.report.title')}</h2>
          <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-70">{t('agent.hub.report.body')}</p>
        </div>
      </div>

      {!available ? (
        <p className="text-[0.8125rem] text-ink-45">{t('agent.hub.report.unavailable')}</p>
      ) : link ? (
        <>
          <p className="u-tabular truncate rounded-lg bg-canvas-alt px-3 py-2 text-[0.8125rem] text-ink" title={link.url}>{link.url}</p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(ownerMessage(link.url))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="u-press inline-flex h-10 items-center gap-1.5 rounded-lg bg-green px-3.5 text-[0.8125rem] font-semibold text-white"
            >
              <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('agent.hub.report.sendWhatsApp')}
            </a>
            <button
              type="button"
              onClick={copy}
              className="u-press u-btn-secondary inline-flex h-10 items-center gap-1.5 rounded-lg px-3.5 text-[0.8125rem] font-semibold text-ink"
            >
              {copied ? <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-success" /> : <Copy strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />}
              {copied ? t('agent.hub.report.copied') : t('agent.hub.report.copy')}
            </button>
          </div>
          <p className="u-micro text-ink-45">{openedText}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem]">
            {confirmReplace ? (
              <>
                <span className="text-ink-70">{t('agent.hub.report.replaceWarning')}</span>
                <button type="button" disabled={pending} onClick={() => run(() => createReportLinkAction(propertyId, { fresh: true }))} className="font-semibold text-danger">
                  {t('agent.hub.report.replaceConfirm')}
                </button>
                <button type="button" onClick={() => setConfirmReplace(false)} className="text-ink-45">{t('common.actions.cancel')}</button>
              </>
            ) : (
              <>
                <button type="button" disabled={pending} onClick={() => setConfirmReplace(true)} className="inline-flex items-center gap-1 font-semibold text-ink-70 hover:text-ink">
                  <RefreshCw strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                  {t('agent.hub.report.regenerate')}
                </button>
                <button type="button" disabled={pending} onClick={() => run(() => revokeReportLinkAction(propertyId))} className="font-semibold text-ink-45 hover:text-danger">
                  {t('agent.hub.report.revoke')}
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => createReportLinkAction(propertyId))}
          className="u-press u-btn-primary inline-flex h-11 w-fit items-center gap-1.5 rounded-lg bg-blue px-4 text-sm font-bold text-white disabled:opacity-60"
        >
          <Link2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('agent.hub.report.create')}
        </button>
      )}
    </section>
  );
}
