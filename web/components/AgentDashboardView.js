import Link from 'next/link';
import { Building2, Clock, Eye, Heart, MessageCircle, User, Plus } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * Agent dashboard header/stats/chart block — the top of /compte/agent,
 * user-supplied layout (Phase 2.7), corrected before implementation:
 *
 * - No fabricated fallback data. The source design's sample inquiries
 *   ("Jenny Rio"...) and sample chart numbers were the same hardcoded mock
 *   array already flagged in the Hozn audit — every value here comes from
 *   compte/agent/page.js's real, already-fetched analytics/lead functions.
 *   An empty state renders honestly (see below), never an invented row.
 * - Real design tokens (ink/canvas/surface/line/blue/blue-deep/blue-tint),
 *   not the source design's bronze/amber/raw-stone-* classes — this app
 *   deliberately dropped bronze for a blue-accent "Prestige White" palette.
 * - lucide-react icons (already this app's only icon library), not
 *   @heroicons/react — no new dependency needed.
 * - No decorative search input or notification bell: neither had a real
 *   target (no dashboard-wide search, no notification system), and this
 *   codebase's own convention is an honest absent/inert element over a
 *   control that looks interactive but does nothing (see Footer.js's inert
 *   social icons).
 *
 * `addListingHref` is a real wa.me link (lib/whatsapp.js's
 * getCentralWhatsAppHref), never a web form — listings are only ever
 * created through the WhatsApp intake engine (root CLAUDE.md).
 */
const DAY_FORMATTER = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });

export default function AgentDashboardView({ metrics, chartData, recentInquiries, addListingHref }) {
  const maxViews = Math.max(1, ...chartData.map((d) => d.views));
  const hasAnyViews = chartData.some((d) => d.views > 0);

  return (
    <div className="mb-8">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-45">Aperçu de vos performances et de vos demandes clients</p>
        </div>
        {addListingHref && (
          <a
            href={addListingHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 self-start rounded-full bg-blue px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep md:self-auto"
          >
            Ajouter un bien
            <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          </a>
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Mes biens" value={metrics.totalProperties} icon={Building2} />
        <StatCard label="En attente" value={metrics.totalPending} icon={Clock} />
        <StatCard label="Vues des annonces" value={metrics.totalViews} icon={Eye} />
        <StatCard label="Favoris" value={metrics.totalFavourites} icon={Heart} />
        <StatCard label="Vues du profil" value={metrics.totalProfileViews} icon={User} />
        <StatCard label="Clics WhatsApp" value={metrics.totalWhatsappClicks} icon={MessageCircle} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-card border border-line bg-surface p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-ink">Vues des annonces (7 derniers jours)</h2>
          {hasAnyViews ? (
            <div className="flex h-40 items-end justify-between gap-2">
              {chartData.map((d) => (
                <div key={d.date} className="group relative flex h-full flex-1 flex-col items-center justify-end">
                  <div className="pointer-events-none absolute -top-7 rounded bg-ink px-2 py-1 text-[0.625rem] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                    {d.views.toLocaleString('fr-FR')} vue{d.views === 1 ? '' : 's'}
                  </div>
                  <div
                    style={{ height: `${Math.max((d.views / maxViews) * 100, d.views > 0 ? 6 : 0)}%` }}
                    className="w-full max-w-8 rounded-t-sm bg-blue transition-all"
                  />
                  <span className="mt-2 text-[0.6875rem] capitalize text-ink-45">
                    {DAY_FORMATTER.format(new Date(`${d.date}T00:00:00Z`))}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-ink-45">
              Pas encore de vues cette semaine.
            </div>
          )}
        </div>

        <div className="rounded-card border border-line bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Demandes récentes</h2>
            <Link href="#prospects" className="text-xs font-semibold text-blue-deep hover:underline">
              Voir tout
            </Link>
          </div>
          {recentInquiries.length === 0 ? (
            <p className="text-sm text-ink-45">Aucune demande pour le moment.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {recentInquiries.map((lead) => (
                <div key={lead.id} className="border-b border-line pb-4 last:border-0 last:pb-0">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-ink">{lead.name || lead.wa_id}</span>
                    <span className="shrink-0 text-[0.625rem] font-medium text-ink-45">{lead.created_at}</span>
                  </div>
                  <p className="line-clamp-2 text-xs text-ink-45">{lead.requirements_summary || 'Pas de détails fournis.'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon }) {
  return (
    <div className="flex items-center justify-between rounded-card border border-line bg-surface p-4">
      <div>
        <p className="u-eyebrow text-ink-45">{label}</p>
        <p className="u-tabular mt-1 text-2xl font-bold text-ink">{value.toLocaleString('fr-FR')}</p>
      </div>
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-tint text-blue-deep">
        <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
      </div>
    </div>
  );
}
