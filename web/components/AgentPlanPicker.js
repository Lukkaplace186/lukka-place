'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Check, Clock3, Star } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { requestPlanChangeAction } from '@/app/compte/agent/actions';
import { useToast } from './Toast';

const TERM_SUFFIX = { monthly: '/ mois', yearly: '/ an', lifetime: 'une fois' };

function priceLabel(pkg) {
  if (!pkg.price) return 'Gratuit';
  return `${Number(pkg.price).toLocaleString('fr-FR')} $`;
}

/**
 * The real plan ladder: one card per active `packages` row, with that row's
 * own real quotas. There is no invented feature matrix — this schema carries
 * exactly two entitlements per plan (`number_of_property`,
 * `monthly_pitch_limit`) plus the lead-routing weight
 * (`priority_multiplier`), and those three are what's shown.
 *
 * Requesting a plan does two real things, in this order:
 *
 *   1. Files a `plan_change_requests` row. This is the part that persists:
 *      it appears in /admin/subscriptions as a queue an admin works through
 *      and fulfils with the existing assignPackageAction, and it is what
 *      makes an unanswered request visible instead of lost.
 *   2. Opens WhatsApp to the team with the plan pre-filled, so the request
 *      also *arrives* rather than sitting in a queue nobody is watching.
 *
 * This platform has no payment gateway — /admin/subscriptions is a manual
 * ledger by deliberate product decision (cash, bank transfer, Mobile Money).
 * A "Payer maintenant" button would be a fabrication; a request an admin
 * genuinely acts on is the real mechanism, so that's what this is.
 *
 * The WhatsApp window is opened from the click handler *before* awaiting the
 * server action: a popup opened after an await has lost the user-gesture
 * context browsers require, and is blocked. The request is still filed if
 * the popup is blocked anyway, and vice versa — neither depends on the other.
 */
export default function AgentPlanPicker({ packages, currentPackageId, openRequestPackageIds }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [requestedId, setRequestedId] = useState(null);
  const openRequests = new Set(openRequestPackageIds || []);

  function handleRequest(pkg) {
    setRequestedId(pkg.id);

    // NEXT_PUBLIC_WHATSAPP_NUMBER is a public env var by design (it is the
    // one dialable central number, already inlined into ~15 CTAs across the
    // public site), so this client component resolves the href itself rather
    // than being handed one — same helper, same null-when-unset behaviour.
    const whatsappHref = getCentralWhatsAppHref(
      `Bonjour, je souhaite passer au forfait « ${pkg.title} » (${priceLabel(pkg)} ${
        TERM_SUFFIX[pkg.term] || ''
      }) sur Lukka Place.`,
    );
    if (whatsappHref) window.open(whatsappHref, '_blank', 'noopener');

    startTransition(async () => {
      const result = await requestPlanChangeAction(pkg.id);
      setRequestedId(null);
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      showToast({
        type: 'success',
        message: result.created
          ? `Demande envoyée — l’équipe Lukka Place vous contacte pour activer « ${pkg.title} ».`
          : `Votre demande pour « ${pkg.title} » est déjà en cours de traitement.`,
      });
      router.refresh();
    });
  }

  if (!packages.length) {
    return (
      <div className="u-card rounded-card bg-surface px-6 py-12 text-center">
        <p className="u-micro text-ink-45">
          Aucun forfait n’est ouvert à la souscription pour le moment. Contactez l’équipe Lukka Place pour
          connaître les options disponibles.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {packages.map((pkg) => {
        const isCurrent = currentPackageId === pkg.id;
        const isRequested = openRequests.has(pkg.id);
        const priority = Number(pkg.priority_multiplier) || 1;

        return (
          <div
            key={pkg.id}
            className={`u-card flex flex-col gap-4 rounded-card bg-surface p-5 ${
              isCurrent ? 'ring-2 ring-blue' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="u-title-card truncate text-ink">{pkg.title || 'Forfait'}</div>
                <div className="u-micro mt-0.5 text-ink-45">
                  {pkg.is_trial ? `Essai de ${pkg.trial_days || 0} jours` : TERM_SUFFIX[pkg.term] || pkg.term}
                </div>
              </div>
              {isCurrent && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-tint px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] text-blue-deep">
                  <Check strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                  Actuel
                </span>
              )}
            </div>

            <div className="u-stat text-ink">{priceLabel(pkg)}</div>

            <ul className="flex flex-col gap-2 border-t border-line pt-3.5">
              <li className="u-micro flex items-start gap-2 text-ink-70">
                <Check strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-blue" />
                <span>
                  {pkg.number_of_property == null
                    ? 'Biens publiés illimités'
                    : `${pkg.number_of_property} biens publiés`}
                </span>
              </li>
              <li className="u-micro flex items-start gap-2 text-ink-70">
                <Check strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-blue" />
                <span>{pkg.monthly_pitch_limit ?? 10} demandes clients traitées par mois</span>
              </li>
              {priority > 1 && (
                <li className="u-micro flex items-start gap-2 text-ink-70">
                  <Star strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-brass-deep" />
                  <span>
                    Priorité ×{priority} dans l’attribution automatique des demandes de vos communes
                  </span>
                </li>
              )}
            </ul>

            <div className="mt-auto pt-1">
              {isCurrent ? (
                <span className="u-micro-strong inline-flex h-10 items-center text-ink-45">
                  Votre forfait actuel
                </span>
              ) : isRequested ? (
                <span className="u-micro-strong inline-flex h-10 items-center gap-1.5 text-warning">
                  <Clock3 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                  Demande en cours
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleRequest(pkg)}
                  disabled={pending}
                  className="u-btn-primary u-press inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-blue px-4 text-[0.8125rem] font-bold text-white disabled:opacity-60"
                >
                  {pending && requestedId === pkg.id ? 'Envoi…' : 'Demander ce forfait'}
                  <ArrowUpRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
