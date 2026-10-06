'use client';

import { useMemo, useOptimistic, useRef, useState } from 'react';
import { Phone, Calculator, Home, Send, Check, Target, MoreHorizontal } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { bestMatch } from '@/lib/agentMatching';
import { leadTelHref, leadWhatsAppLink } from '@/lib/leadContact';
import { WhatsAppIcon } from './WhatsAppCTA';
import AgentQuickReplies from './AgentQuickReplies';
import AgentAlternativesDialog from './AgentAlternativesDialog';
import { useToast } from './Toast';
import { useT } from '@/lib/i18n/client';

/**
 * One customer enquiry in the agent's single Demandes inbox (2026-10-06
 * redesign, same anatomy as AgentVisitRequestCard): name, state and age on
 * top; what they asked for, the listing and the budget under it; then ONE
 * primary action — "Répondre sur WhatsApp", a wa.me link from the agent's
 * OWN WhatsApp, pre-filled in French (lib/leadContact.js), which has no 24h
 * window — beside a call icon and "···".
 *
 * "···" holds the rest: alternatives, quick replies, the Lukka Place
 * composer (replyToLeadAction, a real WhatsApp send through the engine),
 * "Marquer comme traitée" and the status select. A status change shows on
 * the tag at once (useOptimistic); a failure puts the old status back with a
 * toast.
 *
 * Match % is a real computed score (lib/agentMatching.js), absent rather than
 * fabricated when the request gives nothing to score against.
 *
 * `highlighted` marks the one request an agent arrived here to see from a
 * WhatsApp alert's deep link — see services/leadDispatch.js's agentLink.
 */
// One colour per stage: Nouvelle solid royal (it waits on the agent),
// Contactée grey, Qualifiée green, Visite demandée amber. Every pair is ≥4.5:1
// for its 11px text (amber uses --warning-ink, see globals.css).
const STATUS_TAG = {
  NEW: 'bg-blue text-white',
  CONTACTED: 'bg-canvas-deep text-ink-70',
  QUALIFIED: 'bg-success-tint text-success',
  VIEWING_REQUESTED: 'bg-warning-tint text-warning-ink',
  VIEWING_COMPLETED: 'bg-blue-tint text-blue-deep',
  CONVERTED: 'bg-success-tint text-success',
  LOST: 'bg-canvas-deep text-ink-45',
};

const QUICK_REPLIES = [
  { labelKey: 'agent.leads.quickReplies.availableLabel', textKey: 'agent.leads.quickReplies.availableBody' },
  { labelKey: 'agent.leads.quickReplies.viewingLabel', textKey: 'agent.leads.quickReplies.viewingBody' },
  { labelKey: 'agent.leads.quickReplies.documentsLabel', textKey: 'agent.leads.quickReplies.documentsBody' },
];

const PRIMARY = 'u-press inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-[0.9375rem] font-bold';
const ICON_BUTTON = 'u-press grid h-12 w-12 shrink-0 place-items-center rounded-xl text-ink-70 ring-1 ring-inset ring-ink-25 transition-colors hover:bg-canvas-alt hover:text-ink';
const SECONDARY = 'u-press inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg text-[0.8125rem] font-semibold transition-colors';

export default function AgentLeadCard({
  lead,
  statusLabel,
  statusOptions,
  relativeTime,
  budget,
  target,
  replyAction,
  statusAction,
  myListings = [],
  highlighted = false,
}) {
  const t = useT();
  const { showToast } = useToast();
  const [composerOpen, setComposerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [status, setOptimisticStatus] = useOptimistic(lead.status);
  const textareaRef = useRef(null);
  const name = lead.name || lead.wa_id;

  const statusText =
    status === lead.status
      ? statusLabel
      : t(statusOptions.find((o) => o.value === status)?.labelKey || '') || status;

  // Form action: runs inside a transition, so the optimistic status holds
  // until the server's revalidated page replaces it.
  async function changeStatus(formData) {
    setOptimisticStatus(String(formData.get('status') || lead.status));
    try {
      await statusAction(formData);
    } catch (err) {
      console.error('[AgentLeadCard] status change failed', err);
      showToast({ type: 'error', message: t('errors.submissionFailed') });
    }
  }

  const best = useMemo(() => bestMatch(myListings, lead), [myListings, lead]);
  const directLink = useMemo(() => leadWhatsAppLink(lead, myListings), [lead, myListings]);
  const telHref = leadTelHref(lead.wa_id);

  function insertQuickReply(text) {
    const el = textareaRef.current;
    if (!el) return;
    el.value = el.value.trim() ? `${el.value.trim()}\n${text}` : text;
    el.focus();
  }

  return (
    <article className={`u-card rounded-card bg-surface p-4 sm:p-5 ${highlighted ? 'ring-2 ring-blue' : ''}`}>
      {highlighted && (
        <p className="u-micro-strong mb-3 inline-flex items-center gap-1.5 rounded-full bg-blue-tint px-3 py-1 text-blue-deep">
          <Target strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
          {t('agent.leads.fromWhatsAppAlert')}
        </p>
      )}

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-ink">{name}</p>
          <p className="text-xs text-ink-45">
            {t('agent.inbox.kind.enquiry')} · {relativeTime}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] ${STATUS_TAG[status] || STATUS_TAG.NEW}`}>
          {statusText}
        </span>
      </header>

      <div className="mt-3 flex flex-col gap-1.5">
        {lead.requirements_summary && (
          <p className="line-clamp-3 text-[0.9375rem] font-semibold leading-snug text-ink">{lead.requirements_summary}</p>
        )}
        {target && (
          <p className="flex min-w-0 items-center gap-2 text-sm text-ink-70">
            <Home strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-35" aria-hidden="true" />
            <span className="truncate">{target}</span>
          </p>
        )}
        {(budget || best) && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-70">
            {budget && (
              <span className="inline-flex items-center gap-2">
                <Calculator strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-35" aria-hidden="true" />
                {budget}
              </span>
            )}
            {best && (
              <span
                title={t('agent.leads.bestMatchAria', { title: best.listing.title })}
                className="inline-flex items-center gap-1 rounded-full bg-blue-tint px-2 py-0.5 text-[0.75rem] font-bold text-blue-deep"
              >
                <Target strokeWidth={ICON_STROKE_WIDTH} className="h-3 w-3" />
                {t('agent.inbox.matchScore', { score: best.score })}
              </span>
            )}
          </p>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2">
        {directLink ? (
          <a href={directLink} target="_blank" rel="noopener noreferrer" className={`${PRIMARY} bg-green-ink text-white hover:brightness-110`}>
            <WhatsAppIcon className="h-5 w-5 shrink-0" />
            <span className="truncate">{t('agent.leads.replyOnWhatsApp')}</span>
          </a>
        ) : (
          <div className="min-w-0 flex-1">
            <AgentAlternativesDialog kind="lead" id={lead.id} emphasis />
          </div>
        )}
        {telHref && (
          <a href={telHref} aria-label={t('agent.leads.call')} title={t('agent.leads.call')} className={ICON_BUTTON}>
            <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
          </a>
        )}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          aria-label={t('agent.leads.moreOptions')}
          title={t('agent.leads.moreOptions')}
          className={`${ICON_BUTTON} ${moreOpen ? 'bg-canvas-alt text-ink' : ''}`}
        >
          <MoreHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
        </button>
      </div>

      {/* Hidden rather than unmounted, so a half-typed reply survives closing it. */}
      <div hidden={!moreOpen} className="mt-3 border-t border-line pt-3">
        <div className="flex flex-col gap-1.5">
          {directLink && <AgentAlternativesDialog kind="lead" id={lead.id} />}

          <AgentQuickReplies waId={lead.wa_id} clientName={lead.name} propertyId={lead.property_id} />

          <button
            type="button"
            onClick={() => setComposerOpen((v) => !v)}
            aria-expanded={composerOpen}
            className={`${SECONDARY} text-ink hover:bg-canvas-alt`}
          >
            <Send strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {composerOpen ? t('common.actions.close') : t('agent.leads.replyViaLukka')}
          </button>

          {composerOpen && (
            <form action={replyAction} className="flex flex-col gap-2.5 rounded-lg bg-canvas-alt p-3">
              <label htmlFor={`reply-${lead.id}`} className="text-[0.8125rem] font-semibold text-ink-70">
                {t('agent.inbox.replyTo', { name })}
              </label>
              <textarea
                id={`reply-${lead.id}`}
                ref={textareaRef}
                name="text"
                rows={3}
                required
                placeholder={t('agent.leads.quickReplies.viewingBody')}
                className="u-focus-ring resize-y rounded-lg border border-line bg-surface p-3 text-base leading-relaxed text-ink placeholder:text-ink-35 sm:text-sm"
              />
              <div className="flex flex-wrap gap-2">
                {QUICK_REPLIES.map((q) => (
                  <button
                    key={q.labelKey}
                    type="button"
                    onClick={() => insertQuickReply(t(q.textKey))}
                    className="u-press inline-flex min-h-11 items-center rounded-full bg-surface px-3.5 text-xs font-semibold text-ink-70 ring-1 ring-line transition-colors hover:text-ink"
                  >
                    {t(q.labelKey)}
                  </button>
                ))}
              </div>
              <button type="submit" className="u-btn-primary u-press inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-blue px-4 text-sm font-bold text-white">
                <Send strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                {t('agent.leads.sendMessage')}
              </button>
              <p className="text-xs text-ink-45">{t('agent.inbox.replySentFrom', { number: lead.wa_id })}</p>
            </form>
          )}

          <form action={changeStatus}>
            <input type="hidden" name="status" value={status === 'QUALIFIED' ? 'CONVERTED' : 'QUALIFIED'} />
            <button type="submit" className={`${SECONDARY} text-ink-70 hover:bg-canvas-alt hover:text-ink`}>
              <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {status === 'QUALIFIED' ? t('agent.inbox.markConverted') : t('agent.leads.markHandled')}
            </button>
          </form>

          <form action={changeStatus} className="flex items-center gap-2">
            <label htmlFor={`status-${lead.id}`} className="text-xs font-semibold text-ink-45">
              {t('agent.leads.status')}
            </label>
            <select
              key={status}
              id={`status-${lead.id}`}
              name="status"
              defaultValue={status}
              className="u-focus-ring h-11 min-w-0 flex-1 rounded-full border border-line bg-surface px-2.5 text-xs font-medium text-ink"
            >
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.labelKey)}
                </option>
              ))}
            </select>
            <button type="submit" className="u-press h-11 shrink-0 rounded-full border border-line px-3 text-xs font-medium text-ink transition-colors hover:bg-canvas-alt">
              {t('agent.leads.updateStatus')}
            </button>
          </form>
        </div>
      </div>
    </article>
  );
}
