import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { getOwnListingForEdit, getFeatureAmenities } from '@/lib/agentListings';
import { getLocationHierarchySafe } from '@/lib/locations';
import { getPopularCommunes } from '@/lib/listings';
import { getCdfRate } from '@/lib/currencyRate';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import AgentPageHeader from '@/components/AgentPageHeader';
import AgentListingEditor from '@/components/AgentListingEditor';

export const metadata = {
  title: 'Modifier un bien — Lukka Place',
  robots: { index: false, follow: false },
};

const APPROVE_STATUS = {
  0: { label: 'En attente de validation', className: 'bg-warning-tint text-warning' },
  1: { label: 'Publié', className: 'bg-success-tint text-success' },
  2: { label: 'Rejeté', className: 'bg-danger-tint text-danger' },
};

/**
 * Same degrade-don't-die contract /listings already relies on: the commune
 * list comes from the engine's own kinshasa_locations.json when it is
 * reachable, and from communes that genuinely have approved listings when
 * it is not. An unreachable engine must not take the editor down, and no
 * commune list is ever hardcoded (web/CLAUDE.md).
 */
async function resolveCommunes() {
  const { communes } = await getLocationHierarchySafe();
  if (communes.length > 0) return communes;
  const popular = await getPopularCommunes(24);
  return popular.map((c) => c.commune);
}

export default async function EditListingPage({ params }) {
  const { id } = await params;
  const agentId = await getCurrentAgentId();

  // getOwnListingForEdit scopes on agent_id in the query itself, so a
  // guessed id belonging to another agency resolves to null and 404s here
  // rather than rendering someone else's listing in an editable form.
  const [listing, { newLeadsCount }, communes, cdfRate, amenities] = await Promise.all([
    getOwnListingForEdit(agentId, id),
    getAgentDashboardContext(agentId),
    resolveCommunes(),
    getCdfRate(),
    getFeatureAmenities(),
  ]);

  if (!listing) notFound();

  const approve = APPROVE_STATUS[listing.approve_status];

  return (
    <>
      <AgentPageHeader
        title="Modifier le bien"
        subtitle={listing.title}
        newLeadsCount={newLeadsCount}
        action={
          listing.approve_status === 1 ? (
            <Link
              href={`/listings/${listing.id}`}
              target="_blank"
              className="u-btn-secondary u-press inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-sm font-bold text-ink"
            >
              <ExternalLink strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              Voir en ligne
            </Link>
          ) : null
        }
      />

      <div className="flex flex-col gap-5 px-5 py-7 sm:px-8">
        {approve && (
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={`rounded-full px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.1em] ${approve.className}`}>
              {approve.label}
            </span>
            {listing.approve_status !== 1 && (
              <span className="text-[0.8125rem] text-ink-45">
                Vos modifications sont enregistrées immédiatement, mais le bien ne sera visible publiquement
                qu’après validation par l’équipe Lukka Place.
              </span>
            )}
          </div>
        )}

        <AgentListingEditor listing={listing} communes={communes} cdfRate={cdfRate} amenities={amenities} />
      </div>
    </>
  );
}
