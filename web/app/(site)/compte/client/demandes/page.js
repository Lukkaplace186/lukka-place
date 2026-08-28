import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Send, FileText, ArrowRight } from 'lucide-react';
import { PortalPanel, PortalBadge } from '@/components/ClientPortalUI';
import { getPortalCustomer } from '@/lib/customerPortal';
import { getCustomerInquiries } from '@/lib/customerInquiries';
import { getLocationHierarchySafe } from '@/lib/locations';
import { getPopularCommunes } from '@/lib/listings';
import { LEAD_STATUS_LABELS_FR } from '@/lib/adminLabels';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { submitPropertyRequestAction } from '../actions';
import RequestForm from './RequestForm';

export const metadata = {
  title: 'Soumettre une recherche — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const DATE_FORMATTER = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : DATE_FORMATTER.format(date);
}

const LEAD_TONES = {
  NEW: 'royal',
  CONTACTED: 'royal',
  QUALIFIED: 'royal',
  VIEWING_REQUESTED: 'warning',
  VIEWING_COMPLETED: 'success',
  CONVERTED: 'success',
  LOST: 'neutral',
};

/**
 * The commune options are real, in both branches: the engine's own
 * kinshasa_locations.json hierarchy when it is reachable, and communes
 * derived from the database (getPopularCommunes — communes that actually
 * have approved listings) when it is not. Same degrade-don't-die contract
 * /listings already relies on: an unreachable engine must not take this
 * page down, and no commune list is ever hardcoded here.
 */
async function resolveCommunes() {
  const { communes } = await getLocationHierarchySafe();
  if (communes.length > 0) return communes;
  const popular = await getPopularCommunes(24);
  return popular.map((c) => c.commune);
}

export default async function DemandesPage() {
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client/demandes');

  const [communes, inquiries] = await Promise.all([
    resolveCommunes(),
    getCustomerInquiries(session.customerId),
  ]);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_23.75rem] lg:items-start">
      <RequestForm action={submitPropertyRequestAction} communes={communes} />

      <aside className="flex flex-col gap-5">
        <h3 className="u-eyebrow">Demandes soumises</h3>

        {inquiries.length === 0 ? (
          <PortalPanel className="px-5 py-8 text-center">
            <span className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-canvas-deep text-ink-45">
              <Send strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="text-[0.875rem] leading-relaxed text-ink-45">
              Vos demandes apparaîtront ici dès votre premier envoi, avec leur avancement côté agences.
            </p>
          </PortalPanel>
        ) : (
          inquiries.map(({ lead, listing }) => (
            <PortalPanel key={lead.id} className="p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="u-tabular text-[0.875rem] font-bold text-ink">Demande n° {lead.id}</span>
                <PortalBadge tone={LEAD_TONES[lead.status] || 'neutral'}>
                  {LEAD_STATUS_LABELS_FR[lead.status] || lead.status}
                </PortalBadge>
              </div>

              {lead.requirements_summary ? (
                <p className="mt-2.5 whitespace-pre-line text-[0.8125rem] leading-[1.5] text-ink-70">
                  {lead.requirements_summary}
                </p>
              ) : null}

              <p className="mt-2 text-[0.75rem] text-ink-35">Soumise le {formatDate(lead.created_at)}</p>

              <div className="my-4 h-px bg-line" />

              <div className="flex flex-col gap-2.5">
                {listing ? (
                  <Link
                    href={`/listings/${listing.id}`}
                    className="inline-flex items-center gap-2 text-[0.8125rem] font-semibold text-blue-deep hover:underline"
                  >
                    <FileText strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {listing.title}
                  </Link>
                ) : (
                  <p className="inline-flex items-center gap-2 text-[0.8125rem] text-ink-45">
                    <FileText strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Recherche personnalisée, sans annonce rattachée
                  </p>
                )}

                <Link
                  href="/compte/client/messages"
                  className="inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold text-blue-deep hover:underline"
                >
                  Voir le suivi
                  <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </PortalPanel>
          ))
        )}
      </aside>
    </div>
  );
}
