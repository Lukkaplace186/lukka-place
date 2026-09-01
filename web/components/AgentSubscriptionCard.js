import { BadgeCheck, Sparkles } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';

const TERM_LABELS_FR = { monthly: 'Mensuel', yearly: 'Annuel', lifetime: 'À vie' };

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

/**
 * Real fields only — see web/lib/agents.js's AGENT_FIELDS/AGENT_JOINS for
 * where these come from (packages/memberships, joined on agents.vendor_id).
 * There is no "remaining photo shoot" quantity anywhere in this schema (only
 * a standalone "Photography Service" package an agency could separately
 * subscribe to) — this deliberately does not show a fabricated number for
 * that, per this app's no-fabricated-data rule (web/CLAUDE.md). The one real
 * quota that exists, `packages.number_of_property`, is what's shown below.
 *
 * @param {Object} props
 * @param {string|null} props.packageTitle
 * @param {'monthly'|'yearly'|'lifetime'|null} props.packageTerm
 * @param {number|null} props.isTrial `memberships.is_trial` (0/1) — real
 *   column, currently always 0 in production, kept honest rather than
 *   showing a permanent "Actif" that ignores a state the schema allows.
 * @param {string|Date|null} props.expireDate
 * @param {number} props.listingCount
 * @param {number|null} props.listingLimit
 */
export default function AgentSubscriptionCard({ packageTitle, packageTerm, isTrial, expireDate, listingCount, listingLimit }) {
  const hasSubscription = !!packageTitle;
  const isLifetime = packageTerm === 'lifetime';
  const renewalLabel = formatDate(expireDate);
  const percent = listingLimit ? Math.min(100, Math.round((listingCount / listingLimit) * 100)) : null;

  return (
    <div className="u-card flex flex-col gap-4 rounded-card bg-surface p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[1.125rem] font-bold text-ink">Abonnement</h2>
        {hasSubscription && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] ${
              isTrial ? 'bg-warning-tint text-warning' : 'bg-success-tint text-success'
            }`}
          >
            {isTrial ? (
              <Sparkles strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
            ) : (
              <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
            )}
            {isTrial ? 'Essai' : 'Actif'}
          </span>
        )}
      </div>

      {hasSubscription ? (
        <>
          <div>
            <div className="text-2xl font-extrabold text-ink">{packageTitle}</div>
            <div className="mt-0.5 text-[0.8125rem] text-ink-45">
              {TERM_LABELS_FR[packageTerm] || 'Forfait'}
              {!isLifetime && renewalLabel ? ` · Renouvellement le ${renewalLabel}` : ''}
              {isLifetime ? ' · Aucun renouvellement' : ''}
            </div>
          </div>

          {listingLimit != null && (
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[0.8125rem] font-semibold text-ink-70">
                <span>Biens publiés</span>
                <span className="u-tabular">{listingCount} / {listingLimit}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-blue" style={{ width: `${percent}%` }} />
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-[0.8125rem] leading-relaxed text-ink-45">Aucun abonnement actif pour le moment.</p>
          {(() => {
            const href = getCentralWhatsAppHref('Bonjour, je souhaite souscrire à un abonnement Lukka Place.');
            return href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="u-btn-secondary u-press inline-flex h-10 w-fit items-center rounded-lg px-4 text-[0.8125rem] font-bold text-ink"
              >
                Contacter l’équipe Lukka Place
              </a>
            ) : null;
          })()}
        </>
      )}
    </div>
  );
}
