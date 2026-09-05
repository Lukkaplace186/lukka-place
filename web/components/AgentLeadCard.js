'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, Calculator, MapPin, Send, Check, Target, Building2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { formatPrice } from '@/lib/format';
import { bestMatch } from '@/lib/agentMatching';
import { proposeListingAction } from '@/app/compte/agent/actions';
import { useToast } from './Toast';

/**
 * The design's inquiry card, cloned: contact name + state tag + relative
 * time on one row, the message body, a hairline-topped meta row of
 * icon/value pairs, and a fixed 264px action column carrying a primary
 * "Répondre" over a ghost "Marquer comme traitée". Opening Répondre expands
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
 * "Proposer un bien" moved here from AgentOpenLeadCard, which has been
 * deleted along with the open-request feed it belonged to. The action behind
 * it is unchanged (proposeListingAction -> a real lead_proposals row); what
 * changed is that an agent reaches it from a request the engine pushed to
 * them, rather than from a marketplace they had to go and browse. Match % is
 * still a real computed score (lib/agentMatching.js) against this agent's own
 * listings, and is absent rather than fabricated when the request gives
 * nothing to score against.
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
  { label: 'Bien disponible', text: 'Bonjour, oui le bien est toujours disponible.' },
  { label: 'Proposer une visite', text: 'Bonjour, je peux organiser une visite. Quel jour vous arrange ?' },
  { label: 'Envoyer les documents', text: 'Bonjour, je vous envoie les documents du bien dans un instant.' },
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
  const [open, setOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposePending, startProposeTransition] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();
  const textareaRef = useRef(null);
  const name = lead.name || lead.wa_id;

  const best = useMemo(() => bestMatch(myListings, lead), [myListings, lead]);

  function handlePropose(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startProposeTransition(async () => {
      const result = await proposeListingAction(lead.id, formData);
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      showToast({ type: 'success', message: 'Bien proposé au client.' });
      setProposeOpen(false);
      router.refresh();
    });
  }

  function insertQuickReply(text) {
    const el = textareaRef.current;
    if (!el) return;
    el.value = el.value.trim() ? `${el.value.trim()}\n${text}` : text;
    el.focus();
  }

  return (
    <div className={`u-card rounded-card bg-surface p-6 ${highlighted ? 'ring-2 ring-blue' : ''}`}>
      {highlighted && (
        <p className="u-micro-strong mb-4 inline-flex items-center gap-1.5 rounded-full bg-blue-tint px-3 py-1 text-blue-deep">
          <Target strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
          La demande de votre alerte WhatsApp
        </p>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_16.5rem] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-base font-bold text-ink">{name}</span>
            <span
              className={`rounded-full px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.12em] ${
                STATUS_TAG[lead.status] || STATUS_TAG.NEW
              }`}
            >
              {statusLabel}
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

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="u-btn-primary u-press inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue text-sm font-bold text-white"
          >
            <Send strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
            {open ? 'Fermer' : 'Répondre'}
          </button>

          {myListings.length > 0 && (
            <button
              type="button"
              onClick={() => setProposeOpen(true)}
              className="u-btn-secondary u-press inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg text-[0.8125rem] font-bold text-ink"
            >
              <Building2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              Proposer un bien
            </button>
          )}

          <form action={statusAction}>
            <input type="hidden" name="status" value={lead.status === 'QUALIFIED' ? 'CONVERTED' : 'QUALIFIED'} />
            <button
              type="submit"
              className="u-press inline-flex h-9 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-[0.8125rem] font-semibold text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink"
            >
              <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {lead.status === 'QUALIFIED' ? 'Marquer comme convertie' : 'Marquer comme traitée'}
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
            placeholder="Bonjour, le bien est disponible. Quel jour vous arrange pour la visite ?"
            className="u-focus-ring resize-y rounded-lg border border-line bg-surface p-3 text-sm leading-relaxed text-ink placeholder:text-ink-35"
          />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              {QUICK_REPLIES.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => insertQuickReply(q.text)}
                  className="u-press rounded-full bg-canvas-alt px-3 py-1.5 text-xs font-semibold text-ink-70 transition-colors hover:bg-canvas-deep hover:text-ink"
                >
                  {q.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="u-press h-9 rounded-lg px-3.5 text-[0.8125rem] font-semibold text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="u-btn-primary u-press inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue px-3.5 text-[0.8125rem] font-bold text-white"
              >
                <Send strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                Envoyer le message
              </button>
            </div>
          </div>
          <p className="text-xs text-ink-35">
            Envoyé sur WhatsApp au {lead.wa_id} depuis le numéro Lukka Place.
          </p>
        </form>
      )}

      <form action={statusAction} className="mt-4 flex items-center gap-2 border-t border-line pt-4">
        <label htmlFor={`status-${lead.id}`} className="text-xs font-semibold text-ink-45">
          Statut
        </label>
        <select
          id={`status-${lead.id}`}
          name="status"
          defaultValue={lead.status}
          className="u-focus-ring h-8 rounded-full border border-line bg-surface px-2.5 text-xs font-medium text-ink"
        >
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="u-press h-8 rounded-full border border-line px-2.5 text-xs font-medium text-ink transition-colors hover:bg-canvas-alt"
        >
          Mettre à jour
        </button>
      </form>

      <Dialog open={proposeOpen} onOpenChange={setProposeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Proposer un bien</DialogTitle>
            <DialogDescription>
              Choisissez un bien publié et actif de votre portefeuille. Le client le verra dans son espace
              Lukka Place et pourra vous contacter directement.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handlePropose} className="flex flex-col gap-4">
            <select
              name="property_id"
              required
              defaultValue={best ? String(best.listing.id) : ''}
              className="u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
            >
              <option value="" disabled>
                Choisir un bien…
              </option>
              {myListings.map((listing) => (
                <option key={listing.id} value={listing.id}>
                  {listing.title} — {formatPrice(listing.price, listing.purpose)}
                  {best?.listing.id === listing.id ? ` (${best.score}% correspondance)` : ''}
                </option>
              ))}
            </select>

            <DialogFooter>
              <DialogClose asChild>
                <button
                  type="button"
                  className="u-press inline-flex h-11 items-center rounded-lg px-4 text-sm font-semibold text-ink-45 hover:bg-canvas-alt hover:text-ink"
                >
                  Annuler
                </button>
              </DialogClose>
              <button
                type="submit"
                disabled={proposePending}
                className="u-btn-primary u-press h-11 rounded-lg bg-blue px-5 text-sm font-bold text-white disabled:opacity-60"
              >
                {proposePending ? 'Envoi…' : 'Proposer ce bien'}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
