import Link from 'next/link';
import { BadgeCheck, Plus } from 'lucide-react';
import { listProjectsForAdmin } from '@/lib/developments';
import { STAGE_LABEL_KEYS } from '@/lib/developmentRules';
import { dayLabel } from '@/lib/projectView';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('admin.projects.title'), robots: { index: false, follow: false } };
}

function formatDate(value) {
  return dayLabel(value, 'fr') || '—';
}

/**
 * Every project, drafts included (no public gate here). Small table — the
 * number of developers is tens, not thousands — so no pagination.
 */
export default async function AdminProjectsPage({ searchParams }) {
  const t = await getT();
  const sp = await searchParams;
  const { projects, missing } = await listProjectsForAdmin();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.projects.title')}</h1>
          <p className="u-micro mt-1 max-w-2xl text-ink-70">{t('admin.projects.subtitle')}</p>
        </div>
        <Link href="/admin/projets/nouveau" className="u-btn-primary inline-flex min-h-10 items-center gap-2 rounded-full bg-blue px-4 text-sm font-semibold text-white">
          <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.projects.new')}
        </Link>
      </div>

      {sp.saved === 'deleted' ? <p className="rounded-lg bg-success-tint px-4 py-2 text-sm text-success">{t('admin.projects.saved.deleted')}</p> : null}
      {missing ? <p className="rounded-lg bg-warning-tint px-4 py-2 text-sm text-ink">{t('admin.projects.migrationMissing')}</p> : null}

      {projects.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-surface p-10 text-center text-sm text-ink-70">{t('admin.projects.empty')}</div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-canvas-alt text-left text-[0.75rem] text-ink-45">
              <tr>
                <th className="px-4 py-2 font-semibold">{t('admin.projects.cols.name')}</th>
                <th className="px-4 py-2 font-semibold">{t('admin.projects.cols.kind')}</th>
                <th className="px-4 py-2 font-semibold">{t('admin.projects.cols.developer')}</th>
                <th className="px-4 py-2 font-semibold">{t('admin.projects.cols.commune')}</th>
                <th className="px-4 py-2 font-semibold">{t('admin.projects.cols.content')}</th>
                <th className="px-4 py-2 font-semibold">{t('admin.projects.cols.lastUpdate')}</th>
                <th className="px-4 py-2 font-semibold">{t('admin.projects.cols.status')}</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-t border-line hover:bg-canvas-alt/60">
                  <td className="px-4 py-3">
                    <Link href={`/admin/projets/${p.id}`} className="font-semibold text-ink hover:underline">{p.name}</Link>
                    {p.verified_at ? <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="ml-1 inline h-4 w-4 text-success" aria-label={t('projects.badge.verified')} /> : null}
                  </td>
                  <td className="px-4 py-3 text-ink-70">
                    {p.kind === 'land' ? t('admin.projects.kinds.land') : `${t('admin.projects.kinds.building')} · ${p.stage ? t(STAGE_LABEL_KEYS[p.stage]) : '—'}`}
                  </td>
                  <td className="px-4 py-3 text-ink-70">{p.agency_name || p.developer_name || '—'}</td>
                  <td className="px-4 py-3 text-ink-70">{p.commune || '—'}</td>
                  <td className="px-4 py-3 text-ink-70">
                    {p.kind === 'land'
                      ? t('admin.projects.lotCount', { count: p.lot_count })
                      : t('admin.projects.unitTypeCount', { count: p.unit_type_count })}
                  </td>
                  <td className="px-4 py-3 text-ink-70">{formatDate(p.last_update_on)}</td>
                  <td className="px-4 py-3">
                    {p.approve_status === 1 && p.status === 1 ? (
                      <span className="rounded-full bg-success-tint px-2.5 py-0.5 text-[0.75rem] font-semibold text-success">{t('admin.projects.status.published')}</span>
                    ) : (
                      <span className="rounded-full bg-warning-tint px-2.5 py-0.5 text-[0.75rem] font-semibold text-warning">{t('admin.projects.status.draft')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
