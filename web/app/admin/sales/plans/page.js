import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getAdminSession } from '@/lib/adminSession';
import { can } from '@/lib/adminRoles';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { formatMoneyList } from '@/lib/salesRules';
import { listSalesPlans } from '@/lib/sales';
import { getT } from '@/lib/i18n/server';
import { ErrorNote } from '../../LeadRoutingUI';
import PlansManager from './PlansManager';

export const dynamic = 'force-dynamic';

/** Commission plans: what an onboarding, a subscription and a monthly target are worth. */
export default async function AdminSalesPlansPage() {
  const t = await getT();
  const session = await getAdminSession();
  let plans = [];
  let loadError = null;
  try {
    plans = await listSalesPlans();
  } catch (err) {
    loadError = err.message;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/admin/sales" className="u-micro-strong inline-flex items-center gap-1.5 text-ink-45 hover:text-ink">
          <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.sales.back')}
        </Link>
        <h1 className="u-title-page mt-2 text-ink">{t('admin.sales.plans.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.sales.plans.subtitle')}</p>
      </div>
      {loadError ? <ErrorNote>{t('admin.sales.loadError', { error: loadError })}</ErrorNote> : null}
      <PlansManager
        canManage={can(session?.role, 'sales.manage')}
        plans={plans.map((plan) => ({
          ...plan,
          created_at: undefined,
          onboardingLabel: formatMoneyList([{ currency: plan.currency, amount: plan.onboarding_bonus }], { keepZero: true }),
          targetLabel: plan.monthly_target > 0
            ? t('admin.sales.plans.targetLine', { count: plan.monthly_target, bonus: formatMoneyList([{ currency: plan.currency, amount: plan.target_bonus }]) })
            : null,
        }))}
      />
    </div>
  );
}
