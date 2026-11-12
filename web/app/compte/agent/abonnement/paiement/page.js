import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { getPurchasablePackages } from '@/lib/subscriptions';
import { isFlexpaieConfigured } from '@/lib/flexpaie';
import { payablePackage } from '@/lib/checkoutRules';
import { displayableAgencyName } from '@/lib/agentIdentity';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getFeatureFlags } from '@/lib/siteSettings';
import { getT } from '@/lib/i18n/server';
import AgentPageHeader from '@/components/AgentPageHeader';
import AgentCheckout from '@/components/AgentCheckout';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('agent.checkout.metaTitle'), robots: { index: false, follow: false } };
}

/**
 * /compte/agent/abonnement/paiement?forfait=<package id> — paying for one plan
 * online (design "Paiement abonnement agent", 2026-11-04).
 *
 * Everything shown is real: the plan's title, price and allowances come from
 * its `packages` row, the agency name and phone from the agent's own record.
 * The payment itself is lib/payments.js (FlexPaie mobile money): the form
 * posts to /api/payments/flexpaie/initiate and polls /status. Behind the same
 * `agentSubscriptions` switch as the Abonnement tab, and when FlexPaie has no
 * credentials the page says online payment is not open yet rather than
 * offering a button that would answer 503.
 */
export default async function AgentCheckoutPage({ searchParams }) {
  if (!(await getFeatureFlags()).agentSubscriptions) redirect('/compte/agent');
  const t = await getT();
  const agentId = await getCurrentAgentId();
  const { agent, waitingCount } = await getAgentDashboardContext(agentId);
  const { forfait } = await searchParams;
  const pkg = payablePackage(await getPurchasablePackages(), forfait);
  if (!pkg) redirect('/compte/agent/abonnement');

  const agencyName = displayableAgencyName(agent.agency_name) || displayableAgencyName(agent.vendor_name) || null;

  return (
    <>
      <AgentPageHeader title={t('agent.checkout.title')} newLeadsCount={waitingCount} />
      <div className="flex flex-col gap-5 px-3 py-4 sm:px-8 sm:py-7">
        <Link
          href="/compte/agent/abonnement"
          className="u-micro-strong inline-flex min-h-11 w-fit items-center gap-1.5 text-blue hover:underline"
        >
          <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
          {t('agent.checkout.backToPlans')}
        </Link>
        <AgentCheckout
          pkg={{
            id: pkg.id,
            title: pkg.title,
            price: pkg.price,
            term: pkg.term,
            number_of_property: pkg.number_of_property,
            priority_multiplier: pkg.priority_multiplier,
            photo_sessions_per_month: pkg.photo_sessions_per_month,
            photo_discount_pct: pkg.photo_discount_pct,
          }}
          agencyName={agencyName}
          agentPhone={agent.phone || ''}
          hasAgency={Boolean(agent.vendor_id)}
          onlinePaymentOpen={isFlexpaieConfigured()}
        />
      </div>
    </>
  );
}
