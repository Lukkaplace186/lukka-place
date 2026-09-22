'use client';

import { useMemo, useOptimistic, useRef, useState } from 'react';
import { Phone, Calculator, MapPin, Send, Check, Target, MessageCircle, MoreHorizontal } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { bestMatch } from '@/lib/agentMatching';
import { leadWhatsAppLink } from '@/lib/leadContact';
import AgentQuickReplies from './AgentQuickReplies';
import AgentAlternativesDialog from './AgentAlternativesDialog';
import { useToast } from './Toast';
import { useT } from '@/lib/i18n/client';

/**
 * The design's inquiry card, cloned: contact name + state tag + relative
 * time on one row, the message body, a hairline-topped meta row of
 * icon/value pairs, and a fixed 264px action column carrying a primary
 * t('agent.leads.reply') over a ghost t('agent.leads.markHandled'). Opening Répondre expands
 * a full-width composer across the bottom of the card.
 *
 * Everything the composer does is real: the textarea posts to
 * replyToLeadAction, which sends an actual WhatsApp message through the
 * engine's Chakra connection. The design's quick-reply chips are wired to
 * insert real French starter text into that same textarea rather than being
 * decorative tags — they save typing, they don't send anything by
 * themselves, and the agent always sees exactly what will go out before
 * pressing Envoyer.
 *
 * Simplified 2026-09-22 (product direction: one tap to answer). The only
 * full-width action is "Répondre sur WhatsApp" — a wa.me link from the
 * agent's OWN WhatsApp, pre-filled in French (the customer reads it), which
 * has no 24h-window limit. "Proposer des alternatives" sits under it.
 * Everything else — quick replies, the Lukka Place composer, "marquer comme
 * traitée" and the status select — is in the "Plus d'options" footer.
 * "Proposer un bien" (proposeListingAction, the quota-counted lead_proposals
 * write) is no longer offered: alternatives covers sharing listings, and its
 * monthly quota was blocking agents from answering at all.
 *
 * 2026-09-23: "Proposer des alternatives" moved in with the rest, behind ONE
 * "…" button beside "Répondre sur WhatsApp" — the card had a second
 * full-width button and a full-width "Plus d'options" row under it, three
 * rows of chrome per request on a phone. A status change (Marquer comme
 * traitée, the select) shows on the tag at once (useOptimistic) while the
 * action runs; a failure puts the old status back with a toast.
 *
 * Match % is a real computed score (lib/agentMatching.js), absent rather
 * than fabricated when the request gives nothing to score against.
 *
 * `highlighted` marks the one request an agent arrived here to see from a
 * WhatsApp alert's deep link — see services/leadDispatch.js's agentLink.
 */
const STATUS_TAG = {
  NEW: 'bg-blue-tint text-blue-deep',
  CONTACTED: 'bg-warning-tint text-warning',
  QUALIFIED: 'bg-success-tint text-success',
  VIEWING_REQUESTED: 'bg-warning-tint text-warning',
  VIEWING_COMPLETED: 'bg-blue-tint text-blue-deep',
  CONVERTED: 'bg-success-tint text-success',
  LOST: 'bg-canvas-deep text-ink-45',
};

const QUICK_REPLIES = [
  { labelKey: 'agent.leads.quickReplies.availableLabel', textKey: 'agent.leads.quickReplies.availableBody' },
  { labelKey: 'agent.leads.quickReplies.viewingLabel', textKey: 'agent.leads.quickReplies.viewingBody' },
  { labelKey: 'agent.leads.quickReplies.documentsLabel', textKey: 'agent.leads.quickReplies.documentsBody' },
];

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
  const [open, setOpen] = useState(false);
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

  function insertQuickReply(text) {
    const el = textareaRef.current;
    if (!el) return;
    el.value = el.value.trim() ? `${el.value.trim()}\n${text}` : text;
    el.focus();
  }

  return (
    <div className={`u-card rounded-card bg-surface p-4 sm:p-6 ${highlighted ? 'ring-2 ring-blue' : ''}`}>
      {highlighted && (
        <p className="u-micro-strong mb-4 inline-flex items-center gap-1.5 rounded-full bg-blue-tint px-3 py-1 text-blue-deep">
          <Target strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
          {t('agent.leads.fromWhatsAppAlert')}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_16.5rem] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-base font-bold text-ink">{name}</span>
            <span
              className={`rounded-full px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.12em] ${
                STATUS_TAG[status] || STATUS_TAG.NEW
              }`}
            >
              {statusText}
            </span>
            <span className="text-xs text-ink-35">{relativeTime}</span>
          </div>

          {lead.requirements_summary && (
            <p className="mt-2 max-w-[72ch] text-sm leading-relaxed text-ink-70">{lead.requirements_summary}</p>
          )}

          <div className="mt-3.5 flex flex-wrap gap-x-[1.125rem] gap-y-2 border-t border-line pt-3.5 text-[0.8125rem] text-ink-70">
            <span className="inline-flex items-center gap-1.5">
              <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-35" />
              {lead.wa_id}
            </span>
            {budget && (
              <span className="inline-flex items-center gap-1.5">
                <Calculator strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-35" />
                {budget}
              </span>
            )}
            {target && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MapPin strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-35" />
                <span className="truncate">{target}</span>
              </span>
            )}
            {best && (
              <span
                title={`Meilleure correspondance dans votre portefeuille : ${best.listing.title}`}
                className="inline-flex items-center gap-1 rounded-full bg-blue-tint px-2 py-0.5 text-[0.75rem] font-bold text-blue-deep"
              >
                <Target strokeWidth={ICON_STROKE_WIDTH} className="h-3 w-3" />
                {best.score}% correspondance
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {directLink ? (
            <a
              href={directLink}
              target="_blank"
              rel="noopener noreferrer"
              className="u-btn-primary u-press inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-blue text-sm font-bold text-white"
            >
              <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem] shrink-0" />
              <span className="truncate">{t('agent.leads.replyOnWhatsApp')}</span>
            </a>
          ) : (
            <div className="min-w-0 flex-1">
              <AgentAlternativesDialog kind="lead" id={lead.id} emphasis />
            </div>
          )}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-label={t('agent.leads.moreOptions')}
            title={t('agent.leads.moreOptions')}
            className={`u-press grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line text-ink-70 transition-colors hover:bg-canvas-alt hover:text-ink ${
              moreOpen ? 'bg-canvas-alt text-ink' : ''
            }`}
          >
            <MoreHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Hidden rather than unmounted, so a half-typed reply survives
          closing the panel. */}
      <div hidden={!moreOpen} className="mt-3 border-t border-line pt-3">
        <div className="flex flex-col gap-2">
          {directLink && <AgentAlternativesDialog kind="lead" id={lead.id} />}

          <AgentQuickReplies waId={lead.wa_id} clientName={lead.name} propertyId={lead.property_id} />

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="u-btn-secondary u-press inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg text-[0.8125rem] font-bold text-ink"
          >
            <Send strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {open ? 'Fermer' : t('agent.leads.replyViaLukka')}
          </button>

          <form action={changeStatus}>
            <input type="hidden" name="status" value={status === 'QUALIFIED' ? 'CONVERTED' : 'QUALIFIED'} />
            <button
              type="submit"
              className="u-press inline-flex h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-[0.8125rem] font-semibold text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink"
            >
              <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {status === 'QUALIFIED' ? 'Marquer comme convertie' : t('agent.leads.markHandled')}
            </button>
          </form>

          <form action={changeStatus} className="flex items-center gap-2">
            <label htmlFor={`status-${lead.id}`} className="text-xs font-semibold text-ink-45">
              Statut
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
            <button
              type="submit"
              className="u-press h-11 shrink-0 rounded-full border border-line px-2.5 text-xs font-medium text-ink transition-colors hover:bg-canvas-alt"
            >
              {t('agent.leads.updateStatus')}
            </button>
          </form>
        </div>
      </div>

      {open && (
        <form action={replyAction} className="mt-4 flex flex-col gap-2.5 border-t border-line pt-4">
          <label htmlFor={`reply-${lead.id}`} className="text-[0.8125rem] font-semibold text-ink-70">
            Votre réponse à {name}
          </label>
          <textarea
            id={`reply-${lead.id}`}
            ref={textareaRef}
            name="text"
            rows={3}
            required
            placeholder={t('agent.leads.quickReplies.viewingBody')}
            className="u-focus-ring resize-y rounded-lg border border-line bg-surface p-3 text-sm leading-relaxed text-ink placeholder:text-ink-35"
          />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              {QUICK_REPLIES.map((q) => (
                <button
                  key={q.labelKey}
                  type="button"
                  onClick={() => insertQuickReply(t(q.textKey))}
                  className="u-press inline-flex min-h-11 items-center rounded-full bg-canvas-alt px-3.5 text-xs font-semibold text-ink-70 transition-colors hover:bg-canvas-deep hover:text-ink"
                >
                  {t(q.labelKey)}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="u-press h-11 rounded-lg px-3.5 text-[0.8125rem] font-semibold text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink"
              >
                {t('common.actions.cancel')}
              </button>
              <button
                type="submit"
                className="u-btn-primary u-press inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue px-3.5 text-[0.8125rem] font-bold text-white"
              >
                <Send strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                {t('agent.leads.sendMessage')}
              </button>
            </div>
          </div>
          <p className="text-xs text-ink-35">
            Envoyé sur WhatsApp au {lead.wa_id} depuis le numéro Lukka Place.
          </p>
        </form>
      )}

    </div>
  );
}

