import { redirect } from 'next/navigation';
import { Mail } from 'lucide-react';
import { PortalSectionHeading, PortalEmpty } from '@/components/ClientPortalUI';
import { getPortalCustomer } from '@/lib/customerPortal';
import { getCustomerInquiries } from '@/lib/customerInquiries';
import { LEAD_STATUS_LABELS_FR } from '@/lib/adminLabels';
import { listingImages } from '@/lib/listingView';
import { formatPrice } from '@/lib/format';
import InquiryThreads from './InquiryThreads';

export const metadata = {
  title: 'Mes messages — Lukka Place',
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
 * Every thread here is one of the customer's own real leads, resolved
 * server-side from their authenticated session's phone number
 * (lib/customerInquiries.js) — never from anything the browser supplies.
 * The engine being unreachable degrades to an empty list rather than a 500,
 * same as /compte/demandes.
 *
 * Prices are serialised with the listing's real stored USD figure rather
 * than the client-side currency toggle: this is transactional history, and
 * lib/whatsapp.js already takes the same position for the same reason.
 */
export default async function MessagesPage() {
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client/messages');

  const inquiries = await getCustomerInquiries(session.customerId);

  if (inquiries.length === 0) {
    return (
      <div>
        <PortalSectionHeading
          title="Mes messages et demandes"
          lead="Vos échanges avec les agences partenaires."
          className="mb-7"
        />
        <PortalEmpty
          icon={Mail}
          title="Aucune demande pour le moment"
          actionLabel="Soumettre une recherche"
          actionHref="/compte/client/demandes"
        >
          Contactez une agence depuis une annonce, ou décrivez-nous le bien que vous cherchez : vos échanges
          apparaîtront ici.
        </PortalEmpty>
      </div>
    );
  }

  const threads = inquiries.map(({ lead, listing }) => ({
    id: lead.id,
    status: lead.status,
    statusLabel: LEAD_STATUS_LABELS_FR[lead.status] || lead.status,
    summary: lead.requirements_summary || null,
    createdAtLabel: formatWith(LONG_DATE, lead.created_at),
    createdAtShort: formatWith(SHORT_DATE, lead.created_at),
    listing: listing
      ? {
          id: listing.id,
          title: listing.title,
          reference: listing.reference || null,
          image: listingImages(listing)[0] || null,
          priceLabel: formatPrice(listing.price, listing.purpose, listing.price_period),
        }
      : null,
  }));

  return (
    <div>
      <PortalSectionHeading
        title="Mes messages et demandes"
        lead={`${threads.length} échange${threads.length > 1 ? 's' : ''} avec les agences partenaires.`}
        className="mb-7"
      />
      <InquiryThreads threads={threads} whatsappNumber={process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || null} />
    </div>
  );
}
