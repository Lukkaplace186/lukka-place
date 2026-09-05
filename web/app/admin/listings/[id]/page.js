import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { getListingForAdmin, getCategoriesForAdmin } from '@/lib/adminListings';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import AdminListingEditor from './AdminListingEditor';

export const metadata = {
  title: 'Modifier une annonce — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

const APPROVE_LABEL = {
  0: { label: 'En attente de validation', className: 'bg-warning-tint text-warning' },
  1: { label: 'Approuvée', className: 'bg-success-tint text-success' },
  2: { label: 'Rejetée', className: 'bg-danger-tint text-danger' },
};

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/**
 * Granular override editing — the capability the admin console was missing.
 *
 * Before this, /admin/listings offered exactly two verbs: Approuver and
 * Rejeter. A listing with a transposed price, a missing commune tag or an
 * AI-mangled title could only be bounced back to the agent over WhatsApp and
 * re-submitted, which is why 6 approved listings still carry no commune at
 * all — nobody had a way to add one.
 *
 * Communes come from the engine's own canonical hierarchy (falling back to
 * DB-derived names when the engine is unreachable), and categories from the
 * real `property_categories` table — so neither select can offer a value that
 * doesn't exist, and the server action re-validates both against those same
 * lists rather than trusting the submitted form.
 */
export default async function AdminListingEditPage({ params }) {
  const { id } = await params;
  const listing = await getListingForAdmin(id);
  if (!listing) notFound();

  const [{ communes }, categories] = await Promise.all([
    getLocationHierarchyWithFallback(),
    getCategoriesForAdmin(),
  ]);

  const approve = APPROVE_LABEL[listing.approve_status];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/admin/listings"
          className="u-micro-strong inline-flex items-center gap-1.5 text-ink-45 hover:text-ink"
        >
          <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          Retour aux annonces
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="u-title-page text-ink">{listing.title || `Annonce #${listing.id}`}</h1>
          {approve && (
            <span
              className={`rounded-full px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] ${approve.className}`}
            >
              {approve.label}
            </span>
          )}
          {Number(listing.status) === 0 && (
            <span className="rounded-full bg-canvas-deep px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] text-ink-45">
              Masquée
            </span>
          )}
        </div>

        <div className="u-micro mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-45">
          <span className="u-ref">#{listing.id}</span>
          <span>Créée le {formatDate(listing.created_at)}</span>
          <span>Modifiée le {formatDate(listing.updated_at)}</span>
          <span>
            Agent :{' '}
            {listing.agent_id ? (
              <Link href={`/admin/agents?q=${listing.agent_phone || ''}`} className="font-semibold text-blue-deep hover:underline">
                {listing.agency_name || listing.agent_username || `#${listing.agent_id}`}
              </Link>
            ) : (
              <span className="font-semibold text-warning">non attribué</span>
            )}
          </span>
          {listing.approve_status === 1 && Number(listing.status) === 1 && (
            <Link
              href={`/listings/${listing.id}`}
              target="_blank"
              className="inline-flex items-center gap-1 font-semibold text-blue-deep hover:underline"
            >
              Voir en ligne
              <ExternalLink strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>

      <AdminListingEditor listing={listing} communes={communes} categories={categories} />
    </div>
  );
}
