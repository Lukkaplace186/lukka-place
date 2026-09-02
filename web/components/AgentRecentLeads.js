import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { formatRelativeFr } from '@/lib/format';

/**
 * The design's "Demandes récentes" card — a "Tout voir" link in the header,
 * then rows led by a small royal dot, with the contact name against an
 * uppercase relative timestamp, the message body, and a meta line.
 *
 * The design's meta line reads "2 500 – 5 000 $ · Villa 4 chambres, Ma
 * Campagne" — budget then target. Both are assembled here from real lead
 * columns (price_min/price_max, then the attached property title falling
 * back to commune/quartier), and any part with no value is simply left out
 * instead of printing an empty segment or a placeholder.
 *
 * The whole card is one link into /compte/agent/demandes — same hover
 * treatment (group + u-press + hover:bg-canvas-alt, a corner arrow that
 * fades in) as AgentStatGrid's clickable metric cells, so the two
 * "this number/list lives elsewhere, click through" surfaces on this page
 * read as one consistent affordance. "Tout voir" stays in the header as a
 * label, not a second nested link — an <a> inside an <a> is invalid HTML,
 * and the whole card already goes to the same place.
 */
function metaLine(lead, propertyTitle) {
  const min = lead.price_min != null ? Number(lead.price_min).toLocaleString('fr-FR') : null;
  const max = lead.price_max != null ? Number(lead.price_max).toLocaleString('fr-FR') : null;
  let budget = null;
  if (min && max) budget = `${min} – ${max} $`;
  else if (max) budget = `Jusqu'à ${max} $`;
  else if (min) budget = `À partir de ${min} $`;

  const target = propertyTitle || [lead.quartier, lead.commune].filter(Boolean).join(', ') || null;
  return [budget, target].filter(Boolean).join(' · ');
}

export default function AgentRecentLeads({ leads, listingById }) {
  return (
    <Link
      href="/compte/agent/demandes"
      className="u-card group u-press flex flex-col rounded-card bg-surface p-6 text-left transition-colors hover:bg-canvas-alt"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[1.125rem] font-bold text-ink">Demandes récentes</h2>
        <span className="inline-flex items-center gap-1 text-[0.8125rem] font-bold text-blue">
          Tout voir
          <ArrowUpRight
            strokeWidth={ICON_STROKE_WIDTH}
            aria-hidden="true"
            className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100"
          />
        </span>
      </div>

      {leads.length === 0 ? (
        <p className="mt-6 text-sm text-ink-45">Aucune demande pour le moment.</p>
      ) : (
        <div className="mt-2 flex flex-col">
          {leads.map((lead) => {
            const property = lead.property_id ? listingById?.get(String(lead.property_id)) : null;
            const meta = metaLine(lead, property?.title);
            return (
              <div key={lead.id} className="flex gap-3 border-b border-line py-4 last:border-b-0 last:pb-0">
                <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue" />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-3">
                    <span className="truncate text-sm font-bold text-ink">{lead.name || lead.wa_id}</span>
                    <span className="shrink-0 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-35">
                      {formatRelativeFr(lead.created_at)}
                    </span>
                  </div>
                  {lead.requirements_summary && (
                    <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-relaxed text-ink-70">
                      {lead.requirements_summary}
                    </p>
                  )}
                  {meta && <p className="mt-1.5 text-xs text-ink-45">{meta}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Link>
  );
}
