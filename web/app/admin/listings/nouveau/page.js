import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getCategoriesForAdmin } from '@/lib/adminListings';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { getT } from '@/lib/i18n/server';
import AdminCreateListingForm from './AdminCreateListingForm';

export const dynamic = 'force-dynamic';

export default async function AdminCreateListingPage() {
  const t = await getT();
  const session = await getAdminSession();
  if (!can(session?.role, 'listings.edit')) notFound();

  const [{ communes }, categories] = await Promise.all([
    getLocationHierarchyWithFallback({ city: 'all' }),
    getCategoriesForAdmin(),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/admin/listings" className="u-micro-strong inline-flex items-center gap-1.5 text-ink-45 hover:text-ink">
          <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.moderation.backToListings')}
        </Link>
        <h1 className="u-title-page mt-2 text-ink">{t('admin.listings.create')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.listings.createSubtitle')}</p>
      </div>
      <AdminCreateListingForm
        communes={communes}
        categories={categories}
        canPublish={can(session?.role, 'listings.moderate')}
      />
    </div>
  );
}
