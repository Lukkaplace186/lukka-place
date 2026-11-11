import { redirect } from 'next/navigation';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { getInvoiceForAgent, settleInvoice } from '@/lib/payments';
import { getPool } from '@/lib/db';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { getT } from '@/lib/i18n/server';
import AgentPageHeader from '@/components/AgentPageHeader';
import PaymentReturn from '@/components/PaymentReturn';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('agent.checkout.returnMetaTitle'), robots: { index: false, follow: false } };
}

/**
 * Where the browser lands after MaishaPay's card page
 * (/api/payments/maishapay/webhook sends it here with ?facture=<invoice id>).
 * The query string MaishaPay adds (status=…) is never read as a verdict: the
 * invoice is re-checked with MaishaPay now, and PaymentReturn keeps polling
 * while it is still pending. Another agency's invoice id goes back to
 * Abonnement, the same as an unknown one.
 */
export default async function PaymentReturnPage({ searchParams }) {
  const params = await searchParams;
  const invoiceId = Number.parseInt(params?.facture || '', 10);
  const agentId = await getCurrentAgentId();
  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) redirect('/compte/agent/abonnement');

  let invoice = await getInvoiceForAgent(agentId, invoiceId);
  if (!invoice) redirect('/compte/agent/abonnement');
  if (invoice.status === 'pending') {
    await settleInvoice(invoiceId).catch((err) => console.error(`[payments] return re-check of #${invoiceId} failed: ${err.message}`));
    invoice = await getInvoiceForAgent(agentId, invoiceId);
  }

  const { rows } = await getPool().query('SELECT title FROM packages WHERE id = $1', [invoice.package_id]);
  const t = await getT();
  const { waitingCount } = await getAgentDashboardContext(agentId);

  return (
    <>
      <AgentPageHeader title={t('agent.checkout.title')} newLeadsCount={waitingCount} />
      <div className="px-3 py-6 sm:px-8 sm:py-10">
        <PaymentReturn
          invoiceId={invoice.id}
          initialStatus={invoice.status}
          reference={invoice.reference}
          planTitle={rows[0]?.title || 'Forfait'}
          amount={`${Number(invoice.amount).toLocaleString('fr-FR')} $`}
          packageId={invoice.package_id == null ? null : Number(invoice.package_id)}
          whatsappHref={getCentralWhatsAppHref(t('agent.checkout.helpMessage'))}
        />
      </div>
    </>
  );
}
