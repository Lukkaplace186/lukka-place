'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MessageCircle, ArrowUpRight, ImageIcon, Inbox, CalendarDays, Check } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import { PortalPanel, PortalBadge } from '@/components/ClientPortalUI';
import { buildWhatsAppLink, getCentralWhatsAppHref } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';
import EditPropertyRequestDialog from './EditPropertyRequestDialog';

const TRANSACTION_TYPE_LABELS_FR = { vente: 'Achat', location: 'Location' };

// Mirrors services/db.js's real MAX_PITCHES_PER_LEAD — the actual cap
// enforced server-side on Agent Demand Feed pitches, not a display-only
// guess. Same duplication convention lib/adminLabels.js already uses for
// LEAD_STATUSES/CONVERSATION_STATES (mirrored constants, kept in step by
// hand, rather than an extra round-trip just to fetch one integer).
const MAX_PROPOSALS_PER_LEAD = 7;

/**
 * "2 ch. Location à Limete" — a real, data-derived title for a custom
 * search thread, built from the same structured columns the edit dialog
 * writes (transaction_type/commune/bedrooms). Falls back to a generic label
 * when none of those are set yet (a lead created before this data existed,
 * or one whose customer left every field blank) rather than presenting a
 * blank/fabricated specific commune.
 */
function customSearchTitle(thread) {
  if (!thread.transactionType && !thread.commune && thread.bedrooms == null) {
    return 'Recherche personnalisée';
  }
  const bedroomsPart = thread.bedrooms != null ? `${thread.bedrooms} ch. ` : '';
  const transactionPart = TRANSACTION_TYPE_LABELS_FR[thread.transactionType] || 'Recherche';
  return `${bedroomsPart}${transactionPart} à ${thread.commune || 'Kinshasa'}`;
}

/**
 * The 4-stage tracker for a custom search (Agent Demand Feed) thread, built
 * entirely from real signals already on the lead: it was created (always
 * true once a thread exists), it is open to partner agents (true from the
 * same moment — GET /admin/leads/open lists it immediately, there is no
 * separate "activation" step to fabricate), it has drawn at least one real
 * pitch (`proposals`), and a visit has actually been scheduled/completed or
 * the lead converted. No stage is inferred from anything the UI invents.
 */
function customSearchTrackerSteps(thread) {
  const proposalsCount = thread.proposals?.length || 0;
  const visitPlanned = thread.isViewing || thread.status === 'CONVERTED';
  const steps = [
    { label: 'Demande envoyée', done: true },
    { label: 'Transmis aux agences', done: true },
    { label: `Propositions reçues (${proposalsCount}/${MAX_PROPOSALS_PER_LEAD})`, done: proposalsCount > 0 },
    { label: 'Visite planifiée', done: visitPlanned },
  ];
  const currentIndex = steps.findIndex((step) => !step.done);
  const activeIndex = currentIndex === -1 ? steps.length - 1 : currentIndex;
  return steps.map((step, index) => ({ ...step, current: index === activeIndex }));
}

function StatusTracker({ steps }) {
  return (
    <div className="flex items-start">
      {steps.map((step, index) => (
        <div key={step.label} className="flex flex-1 items-start last:flex-none">
          <div className="flex w-16 shrink-0 flex-col items-center gap-2 text-center sm:w-20">
            <span
              className={cn(
                'grid h-7 w-7 shrink-0 place-items-center rounded-full text-[0.75rem] font-bold',
                step.done
                  ? 'bg-blue text-white'
                  : step.current
                    ? 'bg-blue-tint text-blue-deep shadow-[inset_0_0_0_1.5px_var(--blue)]'
                    : 'bg-canvas-deep text-ink-35',
              )}
            >
              {step.done ? (
                <Check strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                index + 1
              )}
            </span>
            <span
              className={cn(
                'text-[0.6875rem] font-semibold leading-tight',
                step.done || step.current ? 'text-ink' : 'text-ink-35',
              )}
            >
              {step.label}
            </span>
          </div>
          {index < steps.length - 1 ? (
            <div className={cn('mt-3.5 h-px flex-1', step.done ? 'bg-blue' : 'bg-line')} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** "800 $ – 1 500 $" / "à partir de 800 $" / "jusqu'à 1 500 $" — same rounding-free real figures the lead was submitted with. */
function budgetLabel(priceMin, priceMax) {
  const fmt = (n) => `${Number(n).toLocaleString('fr-FR')} $`;
  const hasMin = priceMin != null && Number.isFinite(Number(priceMin));
  const hasMax = priceMax != null && Number.isFinite(Number(priceMax));
  if (hasMin && hasMax) return `${fmt(priceMin)} – ${fmt(priceMax)}`;
  if (hasMin) return `À partir de ${fmt(priceMin)}`;
  if (hasMax) return `Jusqu'à ${fmt(priceMax)}`;
  return null;
}

/**
 * "Mes messages et demandes" — the design's two-pane inbox, over the real
 * leads this customer has actually submitted (the engine's `leads` table,
 * scoped server-side to their own phone number).
 *
 * The design's mockup shows a full message transcript with reply box. That
 * is deliberately NOT reproduced as a transcript here, and the reason is
 * structural, not cosmetic: **this app has no per-customer message
 * transcript to read.** The engine's `messages` rows are reachable only
 * through `GET /admin/conversations/:id`, which has no per-customer
 * (wa_id) scoping, and Lukka Place has no in-app messaging at all — every
 * real conversation happens on WhatsApp (root CLAUDE.md's Lead Routing
 * Rules, and the existing /messages page says exactly this).
 *
 * So the right pane shows what genuinely exists — the request as it was
 * submitted, its real stage, its date, and the listing it concerns — and
 * the primary action continues the conversation where it actually lives.
 * A fake chat bubble here would be the single most tempting fabrication on
 * this page.
 */
const THREAD_TONES = {
  NEW: 'royal',
  CONTACTED: 'royal',
  QUALIFIED: 'royal',
  VIEWING_REQUESTED: 'warning',
  VIEWING_COMPLETED: 'success',
  CONVERTED: 'success',
  LOST: 'neutral',
};

// A statuses like "Qualifié"/"Converti" is internal CRM language a customer
// has no context for. A "Recherche personnalisée" (no listing attached —
// the Trouver pour moi flow) instead gets a 3-stage status derived from the
// same real signals admin/leads already writes: whether an agent has been
// assigned (Request Assignment Routing's real agentId, not the fragile
// display-name-only match) and, once assigned, whether the lead's own
// status has moved past a bare hand-off. No new tracking invented — this is
// the same status/agentId data other admin/agent screens already show,
// read through a customer-friendly lens.
const MATCH_FOUND_STATUSES = new Set(['QUALIFIED', 'VIEWING_REQUESTED', 'VIEWING_COMPLETED', 'CONVERTED']);

function customSearchStatus(thread) {
  // A real agent proposal (Agent Demand Feed) is direct, first-hand evidence
  // a match exists — a stronger signal than the status/agentId heuristic
  // below, which only ever approximated it. Checked first so a request that
  // got a proposal without ever passing through QUALIFIED/etc. still shows
  // the right tier.
  if (thread.proposals?.length > 0) {
    return { tone: 'royal', label: 'Proposition prête' };
  }
  if (!thread.agentId) {
    return { tone: 'warning', label: 'En cours de traitement' };
  }
  if (MATCH_FOUND_STATUSES.has(thread.status)) {
    return { tone: 'royal', label: 'Proposition prête' };
  }
  return { tone: 'success', label: 'Transmis aux agents' };
}

/**
 * Same central-number rule as every other WhatsApp CTA in this app (root
 * CLAUDE.md's Lead Routing Rules) — the message text carries the real
 * listing metadata (title, its own reference, price) instead of a per-listing
 * agent number.
 */
function proposalWhatsAppHref(property, leadId) {
  const refPart = property.reference ? ` (Réf: ${property.reference})` : '';
  return getCentralWhatsAppHref(
    `Bonjour, je suis intéressé par la proposition « ${property.title} »${refPart} — ${property.priceLabel}, pour ma demande n° ${leadId}.`,
  );
}

function Thumbnail({ src, alt, className }) {
  return (
    <div className={cn('relative shrink-0 overflow-hidden rounded-md bg-canvas-deep', className)}>
      {src ? (
        <SafeImage src={src} alt={alt} fill sizes="80px" className="object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-ink-25">
          <ImageIcon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
    </div>
  );
}

export default function InquiryThreads({ threads, whatsappNumber, communes = [], updateAction }) {
  const [activeId, setActiveId] = useState(threads[0]?.id ?? null);
  const active = threads.find((t) => t.id === activeId) || threads[0] || null;

  const continueHref =
    whatsappNumber && active
      ? buildWhatsAppLink(
          whatsappNumber,
          active.listing
            ? `Bonjour, je reviens vers vous au sujet de ma demande du ${active.createdAtLabel} concernant l'annonce Ref: ${active.listing.reference || `#${active.listing.id}`}.`
            : `Bonjour, je reviens vers vous au sujet de ma demande du ${active.createdAtLabel}.`,
        )
      : null;

  // Same two viewing-specific actions the old standalone "Visites
  // planifiées" page offered — reschedule/cancel, not a generic "continue
  // the conversation" — kept verbatim now that a viewing lead renders inline
  // here instead of on its own page.
  const rescheduleHref =
    whatsappNumber && active?.isViewing
      ? buildWhatsAppLink(
          whatsappNumber,
          active.listing
            ? `Bonjour, je souhaite convenir d'un créneau pour la visite de l'annonce Ref: ${active.listing.reference || `#${active.listing.id}`}.`
            : `Bonjour, je souhaite convenir d'un créneau pour ma demande de visite n° ${active.id}.`,
        )
      : null;
  const cancelHref =
    whatsappNumber && active?.isViewing
      ? buildWhatsAppLink(
          whatsappNumber,
          active.listing
            ? `Bonjour, je souhaite annuler ma demande de visite pour l'annonce Ref: ${active.listing.reference || `#${active.listing.id}`}.`
            : `Bonjour, je souhaite annuler ma demande de visite n° ${active.id}.`,
        )
      : null;

  return (
    <PortalPanel className="grid overflow-hidden lg:min-h-[36rem] lg:grid-cols-[22.5rem_minmax(0,1fr)]">
      <div className="flex flex-col border-b border-line lg:border-b-0 lg:border-r">
        <div className="px-5 py-4">
          <p className="u-eyebrow">Vos demandes</p>
        </div>
        <div className="flex max-h-[26rem] flex-col overflow-y-auto lg:max-h-none">
          {threads.map((thread) => {
            const isActive = active?.id === thread.id;
            return (
              <button
                key={thread.id}
                type="button"
                onClick={() => setActiveId(thread.id)}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'flex w-full items-start gap-3.5 border-b border-line px-5 py-4 text-left transition-colors',
                  isActive ? 'bg-blue-tint' : 'hover:bg-canvas-alt',
                )}
              >
                <Thumbnail src={thread.listing?.image || null} alt="" className="h-[3.25rem] w-[3.25rem]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2.5">
                    <span className="truncate text-[0.875rem] font-bold text-ink">
                      {thread.listing ? thread.listing.title : customSearchTitle(thread)}
                    </span>
                    <span className="u-tabular shrink-0 text-[0.75rem] text-ink-35">{thread.createdAtShort}</span>
                  </div>
                  {thread.summary ? (
                    <p className="mt-1.5 line-clamp-2 text-[0.8125rem] leading-[1.45] text-ink-45">
                      {thread.summary}
                    </p>
                  ) : null}
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    {thread.listing ? (
                      <PortalBadge tone={THREAD_TONES[thread.status] || 'neutral'}>{thread.statusLabel}</PortalBadge>
                    ) : (
                      <PortalBadge tone={customSearchStatus(thread).tone}>{customSearchStatus(thread).label}</PortalBadge>
                    )}
                    {thread.isViewing ? (
                      <span className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold text-ink-45">
                        <CalendarDays strokeWidth={ICON_STROKE_WIDTH} className="h-3 w-3" aria-hidden="true" />
                        Visite
                      </span>
                    ) : null}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {active ? (
        <div className="flex flex-col bg-canvas-alt">
          <div className="flex flex-wrap items-center gap-4 border-b border-line bg-surface px-6 py-4">
            <Thumbnail src={active.listing?.image || null} alt="" className="h-[3.25rem] w-16" />
            <div className="min-w-[15rem] flex-1">
              <p className="text-[0.9375rem] font-bold leading-snug text-ink">
                {active.listing ? active.listing.title : customSearchTitle(active)}
              </p>
              <p className="u-tabular mt-1 text-[0.8125rem] text-ink-45">
                {active.listing?.priceLabel ? `${active.listing.priceLabel} · ` : ''}
                Demande du {active.createdAtLabel}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              {active.listing ? (
                <Link
                  href={`/listings/${active.listing.id}`}
                  className="inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold text-blue-deep hover:underline"
                >
                  Voir la fiche
                  <ArrowUpRight strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : null}
              {active.isViewing ? (
                <>
                  {rescheduleHref ? (
                    <a
                      href={rescheduleHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full bg-green px-4 py-2 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-green-deep"
                    >
                      <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                      Convenir d&apos;un créneau
                    </a>
                  ) : null}
                  {cancelHref ? (
                    <a
                      href={cancelHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center rounded-full px-4 py-2 text-[0.8125rem] font-semibold text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink"
                    >
                      Annuler la visite
                    </a>
                  ) : null}
                </>
              ) : continueHref ? (
                <a
                  href={continueHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-green px-4 py-2 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-green-deep"
                >
                  <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                  Poursuivre sur WhatsApp
                </a>
              ) : null}
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-5 p-6">
            {!active.listing ? (
              <div className="rounded-card bg-surface p-5 shadow-[var(--hairline)]">
                <StatusTracker steps={customSearchTrackerSteps(active)} />
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              {active.listing ? (
                <PortalBadge tone={THREAD_TONES[active.status] || 'neutral'}>{active.statusLabel}</PortalBadge>
              ) : (
                <PortalBadge tone={customSearchStatus(active).tone}>{customSearchStatus(active).label}</PortalBadge>
              )}
              <span className="text-[0.8125rem] text-ink-45">
                Envoyée le {active.createdAtLabel}
                {active.proposals?.length > 0
                  ? ` · ${active.proposals.length} proposition${active.proposals.length > 1 ? 's' : ''} active${active.proposals.length > 1 ? 's' : ''}`
                  : ''}
              </span>
            </div>

            <div className="rounded-card bg-surface p-5 shadow-[var(--hairline)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="u-eyebrow">Votre demande</p>
                {updateAction && !active.listing ? (
                  <EditPropertyRequestDialog
                    leadId={active.id}
                    action={updateAction}
                    communes={communes}
                    transactionType={active.transactionType}
                    commune={active.commune}
                    priceMin={active.priceMin}
                    priceMax={active.priceMax}
                    bedrooms={active.bedrooms}
                    requirementsSummary={active.summary}
                  />
                ) : null}
              </div>

              {active.transactionType || active.commune || active.bedrooms != null || active.priceMin != null || active.priceMax != null ? (
                <dl className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3 border-b border-line pb-4 sm:grid-cols-4">
                  {active.transactionType ? (
                    <div>
                      <dt className="text-[0.75rem] text-ink-45">Transaction</dt>
                      <dd className="mt-0.5 text-[0.875rem] font-bold text-ink">
                        {TRANSACTION_TYPE_LABELS_FR[active.transactionType] || active.transactionType}
                      </dd>
                    </div>
                  ) : null}
                  {active.commune ? (
                    <div>
                      <dt className="text-[0.75rem] text-ink-45">Commune</dt>
                      <dd className="mt-0.5 text-[0.875rem] font-bold text-ink">{active.commune}</dd>
                    </div>
                  ) : null}
                  {active.bedrooms != null ? (
                    <div>
                      <dt className="text-[0.75rem] text-ink-45">Chambres</dt>
                      <dd className="u-tabular mt-0.5 text-[0.875rem] font-bold text-ink">{active.bedrooms}</dd>
                    </div>
                  ) : null}
                  {budgetLabel(active.priceMin, active.priceMax) ? (
                    <div>
                      <dt className="text-[0.75rem] text-ink-45">Budget</dt>
                      <dd className="u-tabular mt-0.5 text-[0.875rem] font-bold text-ink">
                        {budgetLabel(active.priceMin, active.priceMax)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}

              {active.summary ? (
                <p className="mt-4 whitespace-pre-line text-[0.9375rem] leading-[1.6] text-ink-70">{active.summary}</p>
              ) : (
                <p className="mt-4 text-[0.875rem] italic text-ink-45">
                  Aucun détail n&apos;a été enregistré avec cette demande.
                </p>
              )}
            </div>

            {active.listing ? (
              <p className="text-[0.8125rem] leading-[1.55] text-ink-45">
                Lukka Place n&apos;a pas de messagerie interne : la réponse de l&apos;agence vous parvient directement
                sur WhatsApp, au numéro rattaché à votre compte.
              </p>
            ) : active.proposals?.length === 0 ? (
              <div className="rounded-card bg-blue-tint p-5">
                <p className="text-[0.9375rem] font-bold leading-snug text-blue-deep">
                  Votre demande est diffusée aux agences{active.commune ? ` de ${active.commune}` : ''}.
                </p>
                <p className="mt-1.5 text-[0.8125rem] leading-[1.55] text-ink-70">
                  Vous recevrez leurs propositions ici et sur WhatsApp.
                </p>
              </div>
            ) : null}

            {active.proposals?.length > 0 && (
              <div className="flex flex-col gap-3">
                <p className="u-eyebrow">
                  Bien{active.proposals.length > 1 ? 's' : ''} proposé{active.proposals.length > 1 ? 's' : ''} par
                  nos agents
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {active.proposals.map((property) => {
                    const proposalHref = proposalWhatsAppHref(property, active.id);
                    return (
                      <div
                        key={property.id}
                        className="flex flex-col overflow-hidden rounded-card bg-surface shadow-[var(--hairline)]"
                      >
                        <div className="relative aspect-[4/3] w-full shrink-0 bg-canvas-deep">
                          {property.image ? (
                            <SafeImage
                              src={property.image}
                              alt=""
                              fill
                              sizes="(min-width: 640px) 50vw, 100vw"
                              className="object-cover"
                            />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center text-ink-25">
                              <ImageIcon strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6" aria-hidden="true" />
                            </span>
                          )}
                        </div>
                        <div className="flex flex-1 flex-col gap-1.5 p-4">
                          <Link
                            href={`/listings/${property.id}`}
                            className="line-clamp-2 text-[0.875rem] font-bold leading-snug text-ink hover:underline"
                          >
                            {property.title}
                          </Link>
                          <p className="u-tabular text-[0.9375rem] font-bold text-blue-deep">{property.priceLabel}</p>
                          {property.agencyName ? (
                            <p className="text-[0.75rem] text-ink-45">Proposé par {property.agencyName}</p>
                          ) : null}
                          {proposalHref && (
                            <a
                              href={proposalHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-green px-4 py-2.5 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-green-deep"
                            >
                              <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                              Discuter de cette offre sur WhatsApp
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 bg-canvas-alt p-10 text-center">
          <Inbox strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6 text-ink-25" aria-hidden="true" />
          <p className="text-[0.875rem] text-ink-45">Sélectionnez une demande pour en voir le détail.</p>
        </div>
      )}
    </PortalPanel>
  );
}
