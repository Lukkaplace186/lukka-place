'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MessageCircle, ArrowUpRight, ImageIcon, Inbox } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import { PortalPanel, PortalBadge } from '@/components/ClientPortalUI';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';

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

export default function InquiryThreads({ threads, whatsappNumber }) {
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
                      {thread.listing ? thread.listing.title : 'Recherche personnalisée'}
                    </span>
                    <span className="u-tabular shrink-0 text-[0.75rem] text-ink-35">{thread.createdAtShort}</span>
                  </div>
                  {thread.summary ? (
                    <p className="mt-1.5 line-clamp-2 text-[0.8125rem] leading-[1.45] text-ink-45">
                      {thread.summary}
                    </p>
                  ) : null}
                  <span className="mt-2 inline-block">
                    <PortalBadge tone={THREAD_TONES[thread.status] || 'neutral'}>{thread.statusLabel}</PortalBadge>
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
                {active.listing ? active.listing.title : 'Recherche personnalisée'}
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
              {continueHref ? (
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
            <div className="flex flex-wrap items-center gap-3">
              <PortalBadge tone={THREAD_TONES[active.status] || 'neutral'}>{active.statusLabel}</PortalBadge>
              <span className="text-[0.8125rem] text-ink-45">Envoyée le {active.createdAtLabel}</span>
            </div>

            <div className="rounded-card bg-surface p-5 shadow-[var(--hairline)]">
              <p className="u-eyebrow mb-2.5">Votre demande</p>
              {active.summary ? (
                <p className="whitespace-pre-line text-[0.9375rem] leading-[1.6] text-ink-70">{active.summary}</p>
              ) : (
                <p className="text-[0.875rem] italic text-ink-45">
                  Aucun détail n&apos;a été enregistré avec cette demande.
                </p>
              )}
            </div>

            <p className="text-[0.8125rem] leading-[1.55] text-ink-45">
              Lukka Place n&apos;a pas de messagerie interne : la réponse de l&apos;agence vous parvient directement
              sur WhatsApp, au numéro rattaché à votre compte.
            </p>
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
