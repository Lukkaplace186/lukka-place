'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  MessageCircle,
  ArrowUpRight,
  ArrowLeft,
  ImageIcon,
  Inbox,
  CalendarDays,
  Check,
  Phone,
  BedDouble,
  MapPin,
} from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import { PortalPanel, PortalBadge } from '@/components/ClientPortalUI';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';
import EditPropertyRequestDialog from './EditPropertyRequestDialog';
import { useT } from '@/lib/i18n/client';

const TRANSACTION_TYPE_LABEL_KEYS = { vente: 'search.tags.purchase', location: 'search.tags.rental' };

/**
 * "Location · Limete · 2 ch. · Budget 843 $ – 960 $" — a compact title built
 * from the same structured columns (commune/bedrooms/price_min/price_max/
 * transaction_type) the edit dialog writes, pipe-separated to match this
 * app's other multi-fact summary lines. The fallback condition intentionally
 * checks only commune/price/bedrooms, not transaction_type — a lead can be
 * meaningfully titled from commune+budget alone even if it somehow has no
 * transaction type on file.
 *
 * A lead whose structured columns were never populated (created before this
 * feature existed, or via the WhatsApp buyer assistant flow, which only
 * ever wrote free text) falls back to its own real `requirements_summary`
 * instead — never a blank/fabricated commune. Only a lead with neither gets
 * the fully generic label.
 */
function customSearchTitle(thread, t) {
  const hasStructured = thread.commune || thread.priceMin != null || thread.priceMax != null || thread.bedrooms != null;
  if (hasStructured) {
    const parts = [];
    if (thread.transactionType) {
      const key = TRANSACTION_TYPE_LABEL_KEYS[thread.transactionType];
      parts.push(key ? t(key) : thread.transactionType);
    }
    if (thread.commune) parts.push(thread.commune);
    if (thread.bedrooms != null) parts.push(`${thread.bedrooms} ch.`);
    const budget = budgetLabel(thread.priceMin, thread.priceMax);
    if (budget) parts.push(`Budget ${budget}`);
    return parts.join(' · ');
  }
  return thread.summary || 'Recherche personnalisée';
}

/**
 * The 3-stage tracker for a custom search thread, built
 * entirely from real signals already on the lead: it was created (always
 * true once a thread exists), it is open to partner agents (true from the
 * same moment — GET /admin/leads/open lists it immediately, there is no
 * separate "activation" step to fabricate), and it has drawn real interest
 * (`proposals`) — the step's own label carries the live count instead of a
 * capacity number a customer has no context for (the 7-pitch cap is an
 * internal per-request pitch cap, not something to expose here).
 *
 * Each step also carries a `description` — the tap-to-reveal micro-copy
 * StatusTracker shows below the row. The last step's description uses the
 * request's own real `commune` when there is one (never a fabricated area),
 * and folds in the honest "jump to the proposals below" pointer once there
 * actually are proposals — there is still no single agency to name here
 * (see proposalWhatsAppHref's doc comment), so the CTA is an anchor into
 * this same page's real per-proposal contact buttons, not a fabricated
 * platform-wide WhatsApp link.
 */
function customSearchTrackerSteps(thread, t) {
  const proposalsCount = thread.proposals?.length || 0;
  const interestLabel =
    proposalsCount > 0
      ? t('account.requests.agenciesInterested', { count: proposalsCount })
      : t('account.requests.agenciesAnalysing');
  const analysingDescription = thread.commune
    ? t('account.requests.stepDescriptions.analysingWithCommune', { commune: thread.commune })
    : t('account.requests.stepDescriptions.analysing');
  const interestDescription =
    proposalsCount > 0
      ? t('account.requests.stepDescriptions.interested', { count: proposalsCount })
      : analysingDescription;
  const steps = [
    { label: t('account.requests.stages.sent'), description: t('account.requests.stepDescriptions.sent'), done: true },
    {
      label: t('account.requests.stages.broadcast'),
      description: t('account.requests.stepDescriptions.broadcast'),
      done: true,
    },
    { label: interestLabel, description: interestDescription, done: proposalsCount > 0, hasProposals: proposalsCount > 0 },
  ];
  const currentIndex = steps.findIndex((step) => !step.done);
  const activeIndex = currentIndex === -1 ? steps.length - 1 : currentIndex;
  return steps.map((step, index) => ({ ...step, current: index === activeIndex }));
}

/**
 * Each step is a real tap target (not just a static dot), opening a shared
 * description panel below the row rather than a per-node floating tooltip —
 * a tooltip pinned above/below the *last* node in a 3-wide row has nowhere
 * good to go on a 375px viewport (the exact class of overflow bug the mobile
 * layout fix elsewhere in this file exists to prevent). Defaults open on the
 * step the tracker itself considers "current", so the micro-copy a customer
 * actually needs ("what does 'agencies reviewing' mean?") is visible without
 * requiring a tap — tapping any step (including the open one, to collapse
 * it) still works exactly as asked.
 *
 * `key={activeThreadId}` from the parent remounts this on every thread
 * switch, so `expandedIndex` doesn't carry the previous thread's open step
 * into a new one.
 */
function StatusTracker({ steps, onProposalsClick, viewProposalsLabel }) {
  const currentIndex = steps.findIndex((step) => step.current);
  const [expandedIndex, setExpandedIndex] = useState(currentIndex);
  const expanded = steps[expandedIndex] || null;

  return (
    <div>
      <div className="flex items-start">
        {steps.map((step, index) => {
          const isOpen = expandedIndex === index;
          return (
            <div key={step.label} className="flex flex-1 items-start last:flex-none">
              <button
                type="button"
                // Functional updater, not `isOpen ? null : index`: `isOpen`
                // is a stale closure over the render that produced this
                // button. Two clicks landing before React re-renders (a fast
                // double-tap, or two synthetic events in the same tick) would
                // both read the same pre-click `isOpen` and both apply the
                // same toggle, cancelling out instead of the second click
                // reversing the first. Reading `current` fresh from state
                // avoids that regardless of batching.
                onClick={() => setExpandedIndex((current) => (current === index ? null : index))}
                aria-expanded={isOpen}
                aria-controls="tracker-step-description"
                className="flex min-h-11 w-16 shrink-0 flex-col items-center gap-2 rounded-md p-1 text-center transition-colors hover:bg-canvas-alt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue sm:w-20"
              >
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
                    'text-[0.6875rem] font-semibold leading-tight underline decoration-dotted decoration-1 underline-offset-2',
                    step.done || step.current ? 'text-ink' : 'text-ink-35',
                    isOpen && 'no-underline',
                  )}
                >
                  {step.label}
                </span>
              </button>
              {index < steps.length - 1 ? (
                <div className={cn('mt-3.5 h-px flex-1', step.done ? 'bg-blue' : 'bg-line')} />
              ) : null}
            </div>
          );
        })}
      </div>
      {expanded ? (
        <p
          id="tracker-step-description"
          className="mt-4 border-t border-line pt-4 text-[0.8125rem] leading-[1.55] text-ink-70"
        >
          {expanded.description}
          {expanded.hasProposals ? (
            <>
              {' '}
              <button
                type="button"
                onClick={onProposalsClick}
                className="font-semibold text-blue-deep underline hover:no-underline"
              >
                {viewProposalsLabel}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
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

function customSearchStatus(thread, t) {
  // A real agent proposal is direct, first-hand evidence
  // a match exists — a stronger signal than the status/agentId heuristic
  // below, which only ever approximated it. Checked first so a request that
  // got a proposal without ever passing through QUALIFIED/etc. still shows
  // the right tier.
  if (thread.proposals?.length > 0) {
    return { tone: 'royal', label: t('account.requests.stages.proposalReady') };
  }
  if (!thread.agentId) {
    return { tone: 'warning', label: t('account.requests.stages.inProgress') };
  }
  if (MATCH_FOUND_STATUSES.has(thread.status)) {
    return { tone: 'royal', label: t('account.requests.stages.proposalReady') };
  }
  return { tone: 'success', label: t('account.requests.stages.sentToAgents') };
}

/**
 * Strict agent-only contact routing (explicit product decision — this
 * deliberately departs from EnquiryCard.js/WhatsAppCTA.js/CallCTA.js's
 * agent-first-with-central-fallback convention on the *public* listing
 * pages, which is unchanged and still correct there): the core journey here
 * is customer submits request -> an agent/commissionaire matches & pitches
 * -> customer reaches that specific agent directly. There is no "contact
 * Lukka Place instead" fallback in this file any more — a proposal with no
 * real `agentPhone` on file (`agents.phone`, via `properties.agent_id`,
 * web/lib/listings.js's SELECT_FIELDS) simply shows no contact button
 * rather than bridging through the platform. `agentPhone` is real, not
 * invented — see web/CLAUDE.md's Known Gaps note on the live-verified
 * `agents.phone` column — it just isn't populated for every agency yet.
 */
function proposalContactMessage(property, leadId) {
  const refPart = property.reference ? ` (Réf: ${property.reference})` : '';
  return `Bonjour, je suis intéressé par la proposition « ${property.title} »${refPart} — ${property.priceLabel}, pour ma demande n° ${leadId}.`;
}

function proposalWhatsAppHref(property, leadId) {
  return property.agentPhone
    ? buildWhatsAppLink(property.agentPhone, proposalContactMessage(property, leadId))
    : null;
}

function proposalCallHref(property) {
  return property.agentPhone ? `tel:${property.agentPhone}` : null;
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

export default function InquiryThreads({
  threads,
  whatsappNumber,
  communes = [],
  updateAction,
  // Set when the customer arrives straight from submitting a request
  // (../actions.js redirects here with ?submitted=<id>), so the tab opens on
  // the thread they just created rather than on whatever sorts first. It is
  // only an initial selection — resolved against the threads this session
  // was already served, so an unknown id simply falls back to the default.
  initialThreadId = null,
}) {
  const t = useT();
  const [activeId, setActiveId] = useState(
    () => (initialThreadId != null && threads.some((thread) => thread.id === initialThreadId)
      ? initialThreadId
      : threads[0]?.id ?? null),
  );
  const active = threads.find((t) => t.id === activeId) || threads[0] || null;

  // Mobile drill-down: `active` above is basically always set (this
  // component only renders once `threads` is non-empty), so gating the
  // detail pane on it alone would show a thread's full detail on first
  // paint even on a phone — the exact "list and detail both open at once"
  // clutter this state exists to fix. `mobileDetailOpen` tracks whether the
  // customer has actually tapped into a thread on THIS visit; it is inert
  // at `lg:` and up, where both panes show side by side as before.
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  function selectThread(id) {
    setActiveId(id);
    setMobileDetailOpen(true);
  }

  function scrollToProposals() {
    document.getElementById('customer-proposals')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Same two viewing-specific actions the old standalone "Visites
  // planifiées" page offered — reschedule/cancel, not a generic "continue
  // the conversation" — kept verbatim now that a viewing lead renders inline
  // here instead of on its own page.
  //
  // Deliberate, flagged exception to this file's strict-agent-only contact
  // policy (see proposalWhatsAppHref's doc comment above): once a viewing
  // is underway there is no reliable link anywhere in the data model back
  // to which specific agent set it up (`viewing_requests` carries no agent
  // column, and a custom-search viewing could have come from any one of
  // several pitching proposals) — using the central number here is an
  // honest fallback to a real gap, not fabricating an agent contact that
  // isn't recorded. Worth a real product decision if this needs closing.
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

  // `grid-cols-1` is load-bearing on mobile, not decorative. A bare `grid`
  // leaves the single track at `auto`, which sizes to the widest child's
  // min-content — and PortalPanel clips (`overflow-hidden`), so the excess
  // was unreachable rather than scrollable: measured 472px of content inside
  // a 343px column at a 375px viewport, with `documentElement.scrollWidth`
  // still 375. Tailwind v4's `grid-cols-1` is `minmax(0,1fr)`, which caps the
  // track at the container. The `min-w-0`s below are the other half of the
  // same fix — a `truncate` (white-space:nowrap) flex item contributes its
  // full untruncated text width as min-content unless it can shrink.
  return (
    <PortalPanel className="grid grid-cols-1 overflow-hidden lg:min-h-[36rem] lg:grid-cols-[22.5rem_minmax(0,1fr)]">
      {/* Hidden once a thread is open on a phone — see mobileDetailOpen
          above. `lg:flex` always wins back at the desktop breakpoint, where
          this pane and the detail pane show side by side regardless. */}
      <div className={cn('flex-col border-b border-line lg:flex lg:border-b-0 lg:border-r', mobileDetailOpen ? 'hidden' : 'flex')}>
        <div className="px-5 py-4">
          <p className="u-eyebrow">{t('account.requests.yourRequests')}</p>
        </div>
        <div className="flex max-h-[26rem] flex-col overflow-y-auto lg:max-h-none">
          {threads.map((thread) => {
            const isActive = active?.id === thread.id;
            const title = thread.listing ? thread.listing.title : customSearchTitle(thread, t);
            // Skip the preview line when it would just repeat the title
            // verbatim — happens for a custom-search thread whose title
            // fell back to its own raw summary (customSearchTitle above).
            const showSummaryPreview = thread.summary && thread.summary !== title;
            return (
              <button
                key={thread.id}
                type="button"
                onClick={() => selectThread(thread.id)}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  // A permanently-reserved 3px left border (transparent when
                  // inactive) is the selection indicator — coloured in for
                  // the active thread without ever shifting the row's
                  // content by those 3px the way adding the border only on
                  // selection would. `active:` is the real tap-feedback
                  // pseudo-class on a touch device; `hover:` mostly doesn't
                  // fire there at all.
                  'flex w-full items-start gap-3.5 border-b border-line border-l-[3px] px-5 py-4 text-left transition-colors',
                  isActive
                    ? 'border-l-blue bg-blue-tint'
                    : 'border-l-transparent hover:bg-canvas-alt active:bg-blue-tint',
                )}
              >
                <Thumbnail src={thread.listing?.image || null} alt="" className="h-[3.25rem] w-[3.25rem]" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline justify-between gap-2.5">
                    <span className="min-w-0 truncate text-[0.875rem] font-bold text-ink">{title}</span>
                    <span className="u-tabular shrink-0 text-[0.75rem] text-ink-35">{thread.createdAtShort}</span>
                  </div>
                  {showSummaryPreview ? (
                    <p className="mt-1.5 line-clamp-2 text-[0.8125rem] leading-[1.45] text-ink-45">
                      {thread.summary}
                    </p>
                  ) : null}
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    {thread.listing ? (
                      <PortalBadge tone={THREAD_TONES[thread.status] || 'neutral'}>{thread.statusLabel}</PortalBadge>
                    ) : (
                      <PortalBadge tone={customSearchStatus(thread, t).tone}>{customSearchStatus(thread, t).label}</PortalBadge>
                    )}
                    {thread.isViewing ? (
                      <span className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold text-ink-45">
                        <CalendarDays strokeWidth={ICON_STROKE_WIDTH} className="h-3 w-3" aria-hidden="true" />
                        {t('account.requests.viewing')}
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
        // Shown only once a thread is open on a phone (mirrors the list
        // pane's own gating above); always shown at `lg:` regardless, same
        // as before this drill-down existed. `animate-in` is a real,
        // functional transition (which pane the customer is looking at just
        // changed) rather than decorative, so it isn't gated through
        // useMotionSafe() the way lib/motion.js's hover/reveal presets are.
        <div className={cn('flex-col bg-canvas-alt lg:flex', mobileDetailOpen ? 'flex animate-in fade-in slide-in-from-right-2 duration-150' : 'hidden')}>
          <button
            type="button"
            onClick={() => setMobileDetailOpen(false)}
            className="flex min-h-11 items-center gap-1.5 border-b border-line bg-surface px-4 text-[0.8125rem] font-semibold text-blue-deep lg:hidden"
          >
            <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
            {t('common.actions.back')}
          </button>
          <div className="flex flex-wrap items-center gap-4 border-b border-line bg-surface px-6 py-4">
            <Thumbnail src={active.listing?.image || null} alt="" className="h-[3.25rem] w-16" />
            {/* basis, not min-width: a hard 240px minimum plus the thumbnail,
                gap and px-6 padding overflows a 375px viewport. flex-basis
                keeps the intended "wrap the actions onto their own line"
                behaviour while still letting the block shrink on a phone. */}
            <div className="min-w-0 flex-1 basis-[15rem]">
              <p className="text-[0.9375rem] font-bold leading-snug text-ink">
                {active.listing ? active.listing.title : customSearchTitle(active, t)}
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
                  {t('account.requests.viewListing')}
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
                      {t('account.requests.arrangeSlot')}
                    </a>
                  ) : null}
                  {cancelHref ? (
                    <a
                      href={cancelHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center rounded-full px-4 py-2 text-[0.8125rem] font-semibold text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink"
                    >
                      {t('account.requests.cancelViewing')}
                    </a>
                  ) : null}
                </>
              ) : null}
              {/* No generic "contact the platform" CTA here any more, for
                  either thread type — a listing-attached thread still has
                  "Voir la fiche" above, which leads to the listing's own
                  EnquiryCard/WhatsAppCTA/CallCTA (real per-listing agent
                  contact); a custom-search thread's real contact points are
                  the per-proposal "Contacter l'agence"/"Appeler" buttons
                  below, once an agent has actually pitched something. */}
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-5 p-6">
            {!active.listing ? (
              <div className="rounded-card bg-surface p-5 shadow-[var(--hairline)]">
                {/* `key` remounts the tracker (and its internal expanded-step
                    state) on every thread switch — see StatusTracker's doc
                    comment. */}
                <StatusTracker
                  key={active.id}
                  steps={customSearchTrackerSteps(active, t)}
                  onProposalsClick={scrollToProposals}
                  viewProposalsLabel={t('account.requests.viewProposalsBelow')}
                />
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              {active.listing ? (
                <PortalBadge tone={THREAD_TONES[active.status] || 'neutral'}>{active.statusLabel}</PortalBadge>
              ) : (
                <PortalBadge tone={customSearchStatus(active, t).tone}>{customSearchStatus(active, t).label}</PortalBadge>
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
                <p className="u-eyebrow">{t('account.requests.yourRequest')}</p>
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
                      <dt className="text-[0.75rem] text-ink-45">{t('account.requests.transaction')}</dt>
                      <dd className="mt-0.5 text-[0.875rem] font-bold text-ink">
                        {TRANSACTION_TYPE_LABEL_KEYS[active.transactionType]
                          ? t(TRANSACTION_TYPE_LABEL_KEYS[active.transactionType])
                          : active.transactionType}
                      </dd>
                    </div>
                  ) : null}
                  {active.commune ? (
                    <div>
                      <dt className="text-[0.75rem] text-ink-45">{t('account.requests.commune')}</dt>
                      <dd className="mt-0.5 text-[0.875rem] font-bold text-ink">{active.commune}</dd>
                    </div>
                  ) : null}
                  {active.bedrooms != null ? (
                    <div>
                      <dt className="text-[0.75rem] text-ink-45">{t('account.requests.bedrooms')}</dt>
                      <dd className="u-tabular mt-0.5 text-[0.875rem] font-bold text-ink">{active.bedrooms}</dd>
                    </div>
                  ) : null}
                  {budgetLabel(active.priceMin, active.priceMax) ? (
                    <div>
                      <dt className="text-[0.75rem] text-ink-45">{t('account.requests.budget')}</dt>
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
                  {t('account.requests.noDetails')}
                </p>
              )}
            </div>

            {active.listing ? (
              <p className="text-[0.8125rem] leading-[1.55] text-ink-45">
                Lukka Place n&apos;a pas de messagerie interne : la réponse de l&apos;agence vous parvient directement
                {t('account.requests.onWhatsAppAtNumber')}
              </p>
            ) : active.proposals?.length === 0 ? (
              <div className="rounded-card bg-blue-tint p-5">
                <p className="text-[0.9375rem] font-bold leading-snug text-blue-deep">
                  {t('account.requests.broadcasting')}
                </p>
                <p className="mt-1.5 text-[0.8125rem] leading-[1.55] text-ink-70">
                  {t('account.requests.broadcastingBody')}
                </p>
              </div>
            ) : null}

            {active.proposals?.length > 0 && (
              <div id="customer-proposals" className="flex scroll-mt-4 flex-col gap-3">
                <p className="u-eyebrow">
                  {t('account.requests.proposedBy', { count: active.proposals.length })}
                  {t('account.requests.ourAgents')}
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {active.proposals.map((property) => {
                    const whatsappHref = proposalWhatsAppHref(property, active.id);
                    const callHref = proposalCallHref(property);
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
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-ink-45">
                            {property.beds != null ? (
                              <span className="inline-flex items-center gap-1">
                                <BedDouble strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
                                {property.beds} ch.
                              </span>
                            ) : null}
                            {property.location ? (
                              <span className="inline-flex items-center gap-1">
                                <MapPin strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
                                {property.location}
                              </span>
                            ) : null}
                          </div>
                          {property.agencyName ? (
                            <p className="text-[0.75rem] text-ink-45">Proposé par {property.agencyName}</p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-2">
                            {whatsappHref && (
                              <a
                                href={whatsappHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-green px-4 py-2.5 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-green-deep"
                              >
                                <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                                {t('account.requests.contactAgency')}
                              </a>
                            )}
                            {callHref && (
                              <a
                                href={callHref}
                                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 py-2.5 text-[0.8125rem] font-semibold text-ink-70 shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-canvas-alt"
                              >
                                <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                                {t('account.requests.call')}
                              </a>
                            )}
                          </div>
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
          <p className="text-[0.875rem] text-ink-45">{t('account.requests.selectOne')}</p>
        </div>
      )}
    </PortalPanel>
  );
}
