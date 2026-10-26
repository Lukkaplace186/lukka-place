import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { getT } from '@/lib/i18n/server';
import AdminCreateAgentForm from './AdminCreateAgentForm';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Créer un agent — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

/** "Créer un agent" — a verified account the team vouches for (lib/adminAgentCreate.js). */
export default async function AdminCreateAgentPage() {
  const t = await getT();
  const session = await getAdminSession();
  if (!can(session?.role, 'agents.manage')) notFound();

  const { communes } = await getLocationHierarchyWithFallback({ city: 'all' });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/admin/agents" className="u-micro-strong inline-flex items-center gap-1.5 text-ink-45 hover:text-ink">
          <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.agents.backToAgents')}
        </Link>
        <h1 className="u-title-page mt-2 text-ink">{t('admin.agentCreate.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.agentCreate.subtitle')}</p>
      </div>
      <AdminCreateAgentForm communes={communes || []} />
    </div>
  );
}
