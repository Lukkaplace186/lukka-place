'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { MessageCircle, Phone, CalendarClock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import FavoriteButton from './FavoriteButton';
import ShareButton from './ShareButton';
import { getCentralWhatsAppHref, buildWhatsAppLink, buildWhatsAppMessage } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { submitVisitRequestAction } from '@/app/(site)/listings/[id]/actions';
import { revealUp } from '@/lib/motion';
import { useMotionSafe } from '@/lib/useMotionSafe';

const FIELD_CLASS =
  'u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-35';

const VISIT_ERROR_MESSAGES = {
  phone: 'Numéro invalide — vérifiez et réessayez.',
  time: 'Indiquez le créneau qui vous arrange.',
  1: "L'envoi a échoué, réessayez.",
};

/**
 * "Demander une visite" — a real Dialog + form-action, same composition
 * DeleteAccountButton.js already established for a public (site) page: a
 * plain trigger button, local `open` state, and a server-action `<form>`
 * inside DialogFooter. The redirect this action ends with closes the dialog
 * on its own (a full page navigation unmounts it); visitSent/visitError
 * feedback is rendered as an always-visible banner on the parent card
 * instead of inside the dialog itself — EnquiryCard renders twice on this
 * page (mobile inline + desktop rail), and a Radix Dialog portals to
 * `document.body`, bypassing whichever instance's parent is CSS-hidden for
 * the current viewport; auto-reopening both on error would show two
 * stacked dialogs at once.
 */
function VisitRequestDialog({ propertyId }) {
  const [open, setOpen] = useState(false);
  const bound = submitVisitRequestAction.bind(null, propertyId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="u-press u-btn-secondary inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-ink"
      >
        <CalendarClock strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
        Demander une visite
      </button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Demander une visite</DialogTitle>
          <DialogDescription>
            Laissez vos coordonnées et le créneau qui vous arrange — l&apos;agent vous confirmera la visite sur WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <form action={bound} className="flex flex-col gap-4">
          <div>
            <label htmlFor="visit-name" className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
              Nom (facultatif)
            </label>
            <input id="visit-name" name="name" placeholder="Votre nom" className={FIELD_CLASS} />
          </div>

          <div>
            <label htmlFor="visit-phone" className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
              Numéro WhatsApp
            </label>
            <input
              id="visit-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              required
              placeholder="099 712 3456 ou +33 612345678"
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label htmlFor="visit-time" className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
              Créneau souhaité
            </label>
            <input
              id="visit-time"
              name="requested_time"
              required
              placeholder="Ex. Samedi matin, 10h"
              className={FIELD_CLASS}
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <button type="button" className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink-70 hover:bg-canvas-alt">
                Annuler
              </button>
            </DialogClose>
            <button type="submit" className="u-btn-primary u-press rounded-lg bg-blue px-5 py-2 text-sm font-bold text-white">
              Envoyer la demande
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The agent panel from web/Design's listing-detail screen — the right
 * rail's first card.
 *
 * Design anatomy: an initials avatar in a royal-50 circle, the agent's name
 * and a qualifying line, a hairline divider, then a full-width primary
 * "Contacter par WhatsApp", a full-width secondary "Appeler l'agent", a
 * ghost Enregistrer/Partager pair, and a caption explaining that the
 * WhatsApp message goes out pre-filled with the reference.
 *
 * This replaces the previous version of this card, which led with the price
 * and a currency toggle. Both moved: the price now leads the main column at
 * 44px (the design's loudest number) and is restated by `PricePanel`
 * directly below this card, and the currency toggle lives in the header on
 * every page.
 *
 * Honest-data notes, unchanged from before:
 *  - `agency_name` / `agent_phone` come from the real agents join
 *    (lib/listings.js) and are NULL on every listing today, so the panel
 *    falls back to naming Lukka Place itself rather than inventing an
 *    agent. The design's "· 34 biens à Kinshasa" qualifier is dropped
 *    entirely — no per-agent listing count is available on this row, and it
 *    is exactly the kind of number that must not be guessed.
 *  - "Appeler l'agent" renders only when a real per-listing number exists.
 *  - WhatsApp falls back to the one central number, and renders a disabled
 *    state (not a dead wa.me link) when that env var is unset.
 *
 * Carries a real `.u-lift` drop shadow instead of this app's usual `.u-card`
 * hairline, per an explicit instruction matching a real Rightmove
 * screenshot — the same scoped, deliberate departure from the design
 * system's normal card treatment as PhotoGallery.js's own frame (see its
 * doc comment).
 *
 * Also plays a quick `revealUp` entrance (lib/motion.js, gated by
 * `useMotionSafe()`) on mount — `animate="visible"`, not `whileInView`.
 * This card shares the gallery's own top row (page.js), so it's normally
 * already inside the initial viewport on load; `whileInView` only fires
 * off an IntersectionObserver crossing, which is not guaranteed to run for
 * an element that starts already-in-view, and confirmed live to leave the
 * card stuck at `opacity: 0` in that case — a real bug, not a cosmetic
 * choice. `animate` fires unconditionally on mount instead. The parent
 * `<aside>` (page.js) still owns the actual sticky behavior via
 * `lg:sticky lg:top-24`.
 */
function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return 'LP';
  return parts.map((p) => p[0].toUpperCase()).join('');
}

export default function EnquiryCard({ listing, visitSent, visitError }) {
  const safe = useMotionSafe();
  const {
    id, title, reference,
    agency_name: agencyName, agent_phone: agentPhone,
  } = listing;

  const message = buildWhatsAppMessage({
    reference: listing.reference,
    slug: listing.slug,
    id: listing.id,
    propertyType: listing.category_name,
    commune: listing.commune,
    price: listing.price,
    purpose: listing.purpose,
  });

  // A real per-listing agent number when one exists, otherwise Lukka
  // Place's own central number — same precedence WhatsAppCTA uses.
  const whatsappHref = agentPhone ? buildWhatsAppLink(agentPhone, message) : getCentralWhatsAppHref(message);
  const displayName = agencyName || 'Lukka Place';
  const qualifier = agencyName ? 'Agent partenaire' : 'Équipe Lukka Place';

  return (
    <motion.div
      variants={safe ? revealUp : undefined}
      initial={safe ? 'hidden' : false}
      animate={safe ? 'visible' : undefined}
      className="u-lift flex flex-col gap-[1.125rem] rounded-card border border-line bg-surface p-6"
    >
      <div className="flex items-center gap-3.5">
        <span className="u-tabular flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center rounded-full bg-blue-tint text-[1.125rem] font-medium text-blue-deep">
          {initialsOf(agencyName)}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[0.875rem] font-bold text-ink">{displayName}</span>
          <span className="text-[0.8125rem] text-ink-45">{qualifier}</span>
        </div>
      </div>

      <div className="h-px bg-line" />

      <div className="flex flex-col gap-2.5">
        {visitSent && (
          <p className="rounded-lg bg-success-tint px-3.5 py-2.5 text-[0.8125rem] font-semibold text-success" role="status">
            Votre demande de visite est partie — l&apos;agent vous répondra sur WhatsApp.
          </p>
        )}
        {visitError && (
          <p className="rounded-lg bg-danger-tint px-3.5 py-2.5 text-[0.8125rem] font-semibold text-danger" role="alert">
            {VISIT_ERROR_MESSAGES[visitError] || VISIT_ERROR_MESSAGES[1]}
          </p>
        )}

        {whatsappHref ? (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="u-press u-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue px-5 py-3 text-sm font-semibold text-white"
          >
            <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
            Contacter par WhatsApp
          </a>
        ) : (
          <span className="inline-flex w-full items-center justify-center rounded-lg border border-line px-5 py-3 text-sm font-semibold text-ink-25">
            Contact indisponible
          </span>
        )}

        <VisitRequestDialog propertyId={id} />

        {/* Real per-listing number only — renders nothing at all rather than
            a tel: link to a number we don't have. */}
        {agentPhone ? (
          <a
            href={`tel:${agentPhone}`}
            className="u-press u-btn-secondary inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-ink"
          >
            <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
            Appeler l&apos;agent
          </a>
        ) : null}

        <div className="flex items-center gap-2">
          <FavoriteButton listingId={id} variant="label" className="flex-1 justify-center" />
          <ShareButton title={title} variant="icon" />
        </div>
      </div>

      {reference ? (
        <p className="text-[0.8125rem] leading-[1.45] text-ink-35">
          Le message WhatsApp part pré-rempli avec la référence{' '}
          <span className="u-ref text-ink-45">{reference}</span> et le lien de l&apos;annonce.
        </p>
      ) : null}
    </motion.div>
  );
}
