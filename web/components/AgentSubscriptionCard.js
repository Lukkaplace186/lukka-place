import Link from 'next/link';
import { BadgeCheck, ArrowUpRight, CalendarClock, Sparkles, TriangleAlert } from 'lucide-react';
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
 * Whole days from now until `value`, or null when there's no usable date.
 * Compared date-to-date rather than instant-to-instant: an expiry stored as
 * a DATE (memberships.expire_date is `date`, not `timestamp`) parses as
 * midnight UTC, so an instant comparison reports "0 days left" for the whole
 * of the final day the agent has actually paid for.
 */
function daysUntil(value) {
  if (!value) return null;
  const end = new Date(value);
  if (Number.isNaN(end.getTime())) return null;
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((endDay - today) / 86400000);
}

function Quota({ label, used, limit, hint, danger = false }) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="u-micro-strong mb-1.5 flex items-center justify-between text-ink-70">
        <span>{label}</span>
        <span className="u-tabular">
          {used} / {limit}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className={`h-full rounded-full ${danger ? 'bg-danger' : 'bg-blue'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {hint ? <p className="u-micro mt-1.5 text-ink-45">{hint}</p> : null}
    </div>
  );
}

/**
 * The agent's own subscription state, in the shape an agent actually needs
 * to answer "am I covered, until when, am I running out, and how do I get
 * more?" — the four questions the previous version of this card left
 * unanswered.
 *
 * What changed and why:
 *
 *  - **The open-request feed is gone.** This card used to end in a
 *    "Propositions activées — proposez vos biens sur les demandes ouvertes
 *    de vos communes" link into a marketplace of unclaimed requests an agent
 *    had to remember to go browse. That pull model is exactly what the
 *    automated matching engine replaces: a matching request is now pushed to
 *    the agent on WhatsApp the moment it is submitted, and lands in Mes
 *    demandes. Nothing here asks the agent to go looking.
 *  - **Real end-of-term facts.** Renewal date, days remaining, and an honest
 *    expired/expiring state. `expire_date` was already being read and was
 *    shown only as a passive sentence; an agent whose plan lapses in four
 *    days needs to be told that, not left to do the date arithmetic.
 *  - **A real upgrade path.** /compte/agent/abonnement lists the genuine
 *    active `packages` rows with their real quotas and files a real request
 *    an admin works through. Previously the only route out of a full quota
 *    was to happen to message the team.
 *
 * Every value below is a real column: `packages.title/term/number_of_property`,
 * `memberships.expire_date/is_trial` (via lib/agents.js's AGENT_FIELDS), and
 * a genuine count of this agent's own responses for the month, counted by the
 * engine that owns that table. Nothing is estimated — a quota whose count
 * couldn't be read renders no bar at all rather than a guess.
 *
 * @param {Object} props
 * @param {string|null} props.packageTitle
 * @param {'monthly'|'yearly'|'lifetime'|null} props.packageTerm
 * @param {number|null} props.isTrial `memberships.is_trial` (0/1).
 * @param {string|Date|null} props.expireDate
 * @param {number} props.listingCount
 * @param {number|null} props.listingLimit `packages.number_of_property`.
 * @param {{limit: number, used: number, remaining: number, exhausted: boolean}|null} props.leadQuota
 *   real monthly lead-response allowance and usage, or null when unreadable.
 * @param {boolean} [props.compact] Overview variant: drops the footer links,
 *   since the overview already sits one click from the full page.
 */
export default function AgentSubscriptionCard({
  packageTitle,
  packageTerm,
  isTrial,
  expireDate,
  listingCount,
  listingLimit,
  leadQuota = null,
  compact = false,
}) {
  const hasSubscription = !!packageTitle;
  const isLifetime = packageTerm === 'lifetime';
  const renewalLabel = formatDate(expireDate);
  const remainingDays = isLifetime ? null : daysUntil(expireDate);
  const expired = remainingDays != null && remainingDays < 0;
  const expiringSoon = remainingDays != null && remainingDays >= 0 && remainingDays <= 14;

  const badge = !hasSubscription
    ? null
    : expired
      ? { label: 'Expiré', className: 'bg-danger-tint text-danger', Icon: TriangleAlert }
      : isTrial
        ? { label: 'Essai', className: 'bg-warning-tint text-warning', Icon: Sparkles }
        : { label: 'Actif', className: 'bg-success-tint text-success', Icon: BadgeCheck };

  return (
    <div className="u-card flex flex-col gap-4 rounded-card bg-surface p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="u-title-card text-ink">Abonnement</h2>
        {badge && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] ${badge.className}`}
          >
            <badge.Icon strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
            {badge.label}
          </span>
        )}
      </div>

      {hasSubscription ? (
        <>
          <div>
            <div className="u-title-section text-ink">{packageTitle}</div>
            <div className="u-micro mt-0.5 text-ink-45">
              {TERM_LABELS_FR[packageTerm] || 'Forfait'}
              {isLifetime ? ' · Aucun renouvellement' : ''}
            </div>
          </div>

          {!isLifetime && renewalLabel && (
            <div
              className={`flex items-start gap-2.5 rounded-lg px-3.5 py-3 ${
                expired ? 'bg-danger-tint' : expiringSoon ? 'bg-warning-tint' : 'bg-canvas-alt'
              }`}
            >
              <CalendarClock
                strokeWidth={ICON_STROKE_WIDTH}
                className={`mt-0.5 h-4 w-4 shrink-0 ${
                  expired ? 'text-danger' : expiringSoon ? 'text-warning' : 'text-ink-45'
                }`}
              />
              <div className="u-micro min-w-0 text-ink-70">
                {expired ? (
                  <>
                    <span className="font-bold text-danger">Abonnement expiré</span> depuis le {renewalLabel}.
                    Vos biens restent enregistrés, mais votre quota n’est plus renouvelé.
                  </>
                ) : (
                  <>
                    <span className="font-bold text-ink">
                      {remainingDays === 0
                        ? 'Se termine aujourd’hui'
                        : `${remainingDays} jour${remainingDays === 1 ? '' : 's'} restant${remainingDays === 1 ? '' : 's'}`}
                    </span>
                    {' — '}
                    échéance le {renewalLabel}.
                  </>
                )}
              </div>
            </div>
          )}

          {listingLimit != null && (
            <Quota
              label="Biens publiés"
              used={listingCount}
              limit={listingLimit}
              danger={listingCount >= listingLimit}
              hint={
                listingCount >= listingLimit
                  ? 'Quota atteint — archivez un bien ou passez à un forfait supérieur pour en publier un de plus.'
                  : null
              }
            />
          )}

          {leadQuota && (
            <Quota
              label="Demandes clients traitées ce mois"
              used={leadQuota.used}
              limit={leadQuota.limit}
              danger={leadQuota.exhausted}
              hint={
                leadQuota.exhausted
                  ? 'Quota atteint — réinitialisé le 1er du mois prochain.'
                  : `${leadQuota.remaining} restante${leadQuota.remaining === 1 ? '' : 's'} ce mois-ci.`
              }
            />
          )}
        </>
      ) : (
        <>
          <div className="u-title-section text-ink">Aucun forfait actif</div>
          <p className="u-micro leading-relaxed text-ink-45">
            Vous pouvez publier et gérer vos biens, mais sans forfait actif votre quota de publications et de
            demandes clients n’est pas renouvelé.
          </p>
        </>
      )}

      {!compact && (
        <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-4">
          <Link
            href="/compte/agent/abonnement"
            className="u-btn-primary u-press inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue px-4 text-[0.8125rem] font-bold text-white"
          >
            {hasSubscription ? 'Gérer mon abonnement' : 'Voir les forfaits'}
            <ArrowUpRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          </Link>
          {(() => {
            const href = getCentralWhatsAppHref(
              'Bonjour, j’ai une question sur mon abonnement Lukka Place.',
            );
            return href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="u-btn-secondary u-press inline-flex h-10 items-center rounded-lg px-4 text-[0.8125rem] font-bold text-ink"
              >
                Parler à l’équipe
              </a>
            ) : null;
          })()}
        </div>
      )}
    </div>
  );
}
