'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { formatPrice } from '@/lib/format';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { proposeListingAction } from '@/app/compte/agent/actions';
import { useToast } from './Toast';

const TRANSACTION_LABELS_FR = { location: 'Location', vente: 'Vente' };
const MAX_PITCHES = 7;

function budgetText(lead) {
  const min = lead.price_min != null ? Number(lead.price_min).toLocaleString('fr-FR') : null;
  const max = lead.price_max != null ? Number(lead.price_max).toLocaleString('fr-FR') : null;
  if (min && max) return `${min} – ${max} $`;
  if (max) return `Jusqu'à ${max} $`;
  if (min) return `À partir de ${min} $`;
  return null;
}

/**
 * Agent Demand Feed's per-request card — deliberately never receives
 * lead.wa_id/lead.name (the engine strips them before this data ever
 * reaches web/, see routes/admin.js's GET /leads/open). "Proposer un bien"
 * pitches one of this agent's own published+active listings; the customer
 * is the one who reaches out afterward (their own proposal card in
 * Messages & Visites carries the real WhatsApp deep link) — this card never
 * sends anything to the customer directly.
 */
export default function AgentOpenLeadCard({ lead, relativeTime, myListings }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const budget = budgetText(lead);

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await proposeListingAction(lead.id, formData);
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      showToast({ type: 'success', message: 'Bien proposé au client.' });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="u-card rounded-card bg-surface p-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_11rem] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-base font-bold text-ink">
              {[TRANSACTION_LABELS_FR[lead.transaction_type], lead.commune].filter(Boolean).join(' · ') || 'Recherche'}
            </span>
            <span className="text-xs text-ink-35">{relativeTime}</span>
          </div>

          {lead.requirements_summary && (
            <p className="mt-2 max-w-[72ch] line-clamp-2 text-sm leading-relaxed text-ink-70">
              {lead.requirements_summary}
            </p>
          )}

          <div className="mt-3.5 flex flex-wrap gap-x-[1.125rem] gap-y-2 border-t border-line pt-3.5 text-[0.8125rem] text-ink-70">
            {budget && <span>{budget}</span>}
            {lead.bedrooms ? <span>{lead.bedrooms} chambre{lead.bedrooms > 1 ? 's' : ''}</span> : null}
            <span className="text-ink-45">{lead.pitches_count || 0}/{MAX_PITCHES} propositions envoyées</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={myListings.length === 0}
          className="u-btn-primary u-press inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-blue text-sm font-bold text-white disabled:opacity-60"
        >
          <Send strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          Proposer un bien
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Proposer un bien</DialogTitle>
            <DialogDescription>
              Choisissez un bien publié et actif de votre portefeuille à proposer pour cette demande.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <select
              name="property_id"
              required
              defaultValue=""
              className="u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
            >
              <option value="" disabled>Choisir un bien…</option>
              {myListings.map((listing) => (
                <option key={listing.id} value={listing.id}>
                  {listing.title} — {formatPrice(listing.price, listing.purpose)}
                </option>
              ))}
            </select>

            <DialogFooter>
              <DialogClose asChild>
                <button type="button" className="u-press inline-flex h-11 items-center rounded-lg px-4 text-sm font-semibold text-ink-45 hover:bg-canvas-alt hover:text-ink">
                  Annuler
                </button>
              </DialogClose>
              <button
                type="submit"
                disabled={pending}
                className="u-btn-primary u-press h-11 rounded-lg bg-blue px-5 text-sm font-bold text-white disabled:opacity-60"
              >
                {pending ? 'Envoi…' : 'Proposer ce bien'}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
