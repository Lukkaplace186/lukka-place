import { redirect } from 'next/navigation';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { getPurchasablePackages } from '@/lib/subscriptions';
import { getFeatureFlags } from '@/lib/siteSettings';
import { isMaishapayConfigured } from '@/lib/maishapay';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { getT } from '@/lib/i18n/server';
import AgentPageHeader from '@/components/AgentPageHeader';
import AgentCheckout from '@/components/AgentCheckout';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('agent.checkout.metaTitle'), robots: { index: false, follow: false } };
}

function formatDateFr(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Kinshasa' }).format(date);
}

/** "0812345678" from a stored 243… number, so the field opens filled; anything else opens empty. */
function nationalNumber(stored) {
  const digits = String(stored || '').replace(/\D/g, '');
  return /^243[89]\d{8}$/.test(digits) ? `0${digits.slice(3)}` : '';
}

/**
 * /compte/agent/abonnement/payer?forfait=<package id> — pay for one plan
 * online through MaishaPay. Hidden (sent back to Abonnement) until both the
 * Abonnements switch is on in /admin/settings and the MaishaPay keys are set;
 * an unknown, free or trial package goes back too, since there is nothing to
 * pay for.
 */
export default async function AgentCheckoutPage({ searchParams }) {
  if (!(await getFeatureFlags()).agentSubscriptions || !isMaishapayConfigured()) redirect('/compte/agent/abonnement');
  const params = await searchParams;
  const packageId = Number.parseInt(params?.forfait || '', 10);
  const packages = await getPurchasablePackages();
  const pkg = packages.find((p) => p.id === packageId && !p.is_trial && Number(p.price) > 0);
  if (!pkg) redirect('/compte/agent/abonnement');

  const t = await getT();
  const agentId = await getCurrentAgentId();
  const { agent, waitingCount } = await getAgentDashboardContext(agentId);
  const trialEndsLabel = agent.subscription_is_trial ? formatDateFr(agent.expire_date) : null;

  return (
    <>
      <AgentPageHeader title={t('agent.checkout.title')} newLeadsCount={waitingCount} />
      <div className="px-3 py-4 sm:px-8 sm:py-7">
        <AgentCheckout
          pkg={{
            id: pkg.id,
            title: pkg.title || 'Forfait',
            price: Number(pkg.price),
            term: pkg.term,
            number_of_property: pkg.number_of_property == null ? null : Number(pkg.number_of_property),
          }}
          trialEndsLabel={trialEndsLabel}
          defaultPhone={nationalNumber(agent.phone)}
          termsHref="/conditions"
          whatsappHref={getCentralWhatsAppHref(t('agent.checkout.helpMessage'))}
        />
      </div>
    </>
  );
}
