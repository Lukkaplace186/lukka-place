import { redirect } from 'next/navigation';
import { Mail } from 'lucide-react';
import { PortalSectionHeading, PortalEmpty } from '@/components/ClientPortalUI';
import { getPortalCustomer, isViewingLead } from '@/lib/customerPortal';
import { getCustomerInquiries } from '@/lib/customerInquiries';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { getPopularCommunes } from '@/lib/listings';
import { LEAD_STATUS_LABELS_FR } from '@/lib/adminLabels';
import { listingImages, feedLocationLine } from '@/lib/listingView';
import { formatPrice } from '@/lib/format';
import { updatePropertyRequestAction } from '../actions';
import InquiryThreads from './InquiryThreads';

export const metadata = {
  title: 'Messages & Visites — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const LONG_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const SHORT_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

function formatWith(formatter, value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : formatter.format(date);
}

/**
 * Same real-or-nothing commune list demandes/page.js already builds for the
 * initial request form — reused here so the edit dialog's commune select
 * never offers an option that isn't real (web/CLAUDE.md's "don't hardcode
 * filter option lists").
 */
async function resolveCommunes() {
  const { communes } = await getLocationHierarchyWithFallback();
  if (communes.length > 0) return communes;
  const popular = await getPopularCommunes(24);
  return popular.map((c) => c.commune);
}

/**
 * Every thread here is one of the customer's own real leads, resolved
 * server-side from their authenticated session's phone number
 * (lib/customerInquiries.js) — never from anything the browser supplies.
 * The engine being unreachable degrades to an empty list rather than a 500,
 * same as /compte/demandes.
 *
 * Prices are serialised with the listing's real stored USD figure rather
 * than the client-side currency toggle: this is transactional history, and
 * lib/whatsapp.js already takes the same position for the same reason.
 *
 * "Visites planifiées" used to be a separate tab/page over a *filtered*
 * subset of this exact same `getCustomerInquiries()` call (any lead whose
 * status is VIEWING_REQUESTED/VIEWING_COMPLETED). Rather than keep two pages
 * re-fetching the same rows, each thread now just carries `isViewing` so the
 * one chronological list can surface viewing-specific status and actions
 * inline (see InquiryThreads.js) instead of duplicating the list elsewhere.
 */
export default async function MessagesPage() {
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client/messages');

  const [inquiries, communes] = await Promise.all([
    getCustomerInquiries(session.customerId),
    resolveCommunes(),
  ]);

  if (inquiries.length === 0) {
    return (
      <div>
        <PortalSectionHeading
          title="Messages & Visites"
          lead="Vos échanges avec les agences partenaires, y compris le suivi de vos demandes de visite."
          className="mb-7"
        />
        <PortalEmpty
          icon={Mail}
          title="Aucune demande pour le moment"
          actionLabel="Trouver pour moi"
          actionHref="/compte/client/demandes"
        >
          Contactez une agence depuis une annonce, ou décrivez-nous le bien que vous cherchez : vos échanges
          apparaîtront ici.
        </PortalEmpty>
      </div>
    );
  }

  const threads = inquiries.map(({ lead, listing, proposals }) => ({
    id: lead.id,
    status: lead.status,
    statusLabel: LEAD_STATUS_LABELS_FR[lead.status] || lead.status,
    summary: lead.requirements_summary || null,
    createdAtLabel: formatWith(LONG_DATE, lead.created_at),
    createdAtShort: formatWith(SHORT_DATE, lead.created_at),
    isViewing: isViewingLead(lead),
    // Real fields backing the "Recherche personnalisée" status banner below
    // (InquiryThreads.js) — commune is the request's own real column, and
    // agentId is the same real assignment /admin/leads now writes (Request
    // Assignment Routing), not a fabricated pipeline stage.
    commune: lead.commune || null,
    agentId: lead.agent_id || null,
    // Structured request fields — real columns POST /leads already writes
    // (root CLAUDE.md's Lead Routing Rules), now also shown/editable in
    // full rather than folded only into the free-text summary above.
    transactionType: lead.transaction_type || null,
    priceMin: lead.price_min ?? null,
    priceMax: lead.price_max ?? null,
    bedrooms: lead.bedrooms ?? null,
    listing: listing
      ? {
          id: listing.id,
          title: listing.title,
          reference: listing.reference || null,
          image: listingImages(listing)[0] || null,
          priceLabel: formatPrice(listing.price, listing.purpose, listing.price_period),
        }
      : null,
    // Agent proposals — real listings agents have pitched
    // against this custom-search request (web/lib/customerInquiries.js).
    // agencyName/agentPhone/beds/location are the same real
    // `agents.username`/`agents.phone`/`properties.beds`/commune-amenity
    // columns SELECT_FIELDS (lib/listings.js) and the listing detail page's
    // own EnquiryCard/WhatsAppCTA/CallCTA already surface via the identical
    // real-per-listing-number-with-central-fallback convention — nothing
    // invented per-card.
    proposals: (proposals || []).map((property) => ({
      id: property.id,
      title: property.title,
      reference: property.reference || null,
      image: listingImages(property)[0] || null,
      priceLabel: formatPrice(property.price, property.purpose, property.price_period),
      agencyName: property.agency_name || null,
      agentPhone: property.agent_phone || null,
      beds: property.beds != null ? property.beds : null,
      location: feedLocationLine(property),
    })),
  }));

  return (
    <div>
      <PortalSectionHeading
        title="Messages & Visites"
        lead={`${threads.length} échange${threads.length > 1 ? 's' : ''} avec les agences partenaires.`}
        className="mb-7"
      />
      <InquiryThreads
        threads={threads}
        whatsappNumber={process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || null}
        communes={communes}
        updateAction={updatePropertyRequestAction}
      />
    </div>
  );
}
