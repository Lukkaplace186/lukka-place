import Link from 'next/link';
import { Building2, Clock, Eye, Heart, MessageCircle, User } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * Agent dashboard's Overview stats + chart + recent-leads block —
 * web/Design's "Vue d'ensemble" screen, restyled onto this app's real data:
 *
 * - No fabricated fallback data or trend deltas. The source design's sample
 *   inquiries and "+18 %"-style deltas have no real backing (there is no
 *   historical snapshot to compare against), so this renders label + real
 *   value only — an honest absence, not an invented arrow.
 * - Real design tokens (ink/canvas/surface/line/blue/blue-deep/blue-tint),
 *   lucide-react icons, matching the rest of this codebase.
 */
const DAY_FORMATTER = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });

const STATS = [
  { key: 'totalProperties', label: 'Biens actifs', icon: Building2 },
  { key: 'totalPending', label: 'En attente', icon: Clock },
  { key: 'totalViews', label: 'Vues des annonces', icon: Eye },
  { key: 'totalFavourites', label: 'Favoris', icon: Heart },
  { key: 'totalProfileViews', label: 'Vues du profil', icon: User },
  { key: 'totalWhatsappClicks', label: 'Clics WhatsApp', icon: MessageCircle },
];

export default function AgentDashboardView({ metrics, chartData, recentInquiries }) {
  const maxViews = Math.max(1, ...chartData.map((d) => d.views));
  const hasAnyViews = chartData.some((d) => d.views > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 divide-x divide-y divide-line rounded-card border border-line bg-white sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
        {STATS.map((s) => (
          <div key={s.key} className="flex items-center justify-between gap-3 p-5">
            <div className="min-w-0">
              <p className="text-xs text-ink-45">{s.label}</p>
              <p className="u-tabular mt-1.5 text-2xl font-extrabold tracking-[-0.02em] text-ink">
                {metrics[s.key].toLocaleString('fr-FR')}
              </p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-tint text-blue-deep">
              <s.icon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-card border border-line bg-white p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-ink">Vues des annonces (7 derniers jours)</h2>
          {hasAnyViews ? (
            <div className="mt-5 flex h-44 items-end justify-between gap-2">
              {chartData.map((d) => (
                <div key={d.date} className="group relative flex h-full flex-1 flex-col items-center justify-end">
                  <div className="pointer-events-none absolute -top-7 rounded bg-ink px-2 py-1 text-[0.625rem] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                    {d.views.toLocaleString('fr-FR')} vue{d.views === 1 ? '' : 's'}
                  </div>
                  <div
                    style={{ height: `${Math.max((d.views / maxViews) * 100, d.views > 0 ? 6 : 0)}%` }}
                    className="w-full max-w-8 rounded-t-md bg-blue transition-all"
                  />
                  <span className="mt-2 text-[0.6875rem] capitalize text-ink-45">
                    {DAY_FORMATTER.format(new Date(`${d.date}T00:00:00Z`))}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 flex h-44 items-center justify-center text-sm text-ink-45">
              Pas encore de vues cette semaine.
            </div>
          )}
        </div>

        <div className="rounded-card border border-line bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink">Demandes récentes</h2>
            <Link href="/compte/agent/demandes" className="text-xs font-bold text-blue-deep hover:underline">
              Tout voir
            </Link>
          </div>
          {recentInquiries.length === 0 ? (
            <p className="mt-4 text-sm text-ink-45">Aucune demande pour le moment.</p>
          ) : (
            <div className="mt-3 flex flex-col">
              {recentInquiries.map((lead) => (
                <div key={lead.id} className="border-t border-line py-4 first:border-0 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-bold text-ink">{lead.name || lead.wa_id}</span>
                    <span className="shrink-0 text-[0.625rem] font-bold uppercase tracking-wide text-ink-35">
                      {lead.created_at}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-ink-45">{lead.requirements_summary || 'Pas de détails fournis.'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
