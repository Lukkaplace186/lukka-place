import { getT } from '@/lib/i18n/server';

/** One titled table card on the dashboard; an honest empty state when there is nothing to count. */
export default async function DashboardPanel({ title, note, isEmpty, children }) {
  const t = await getT();
  return (
    <div className="min-w-0">
      <h2 className="u-title-card mb-2 text-ink">{title}</h2>
      {note ? <p className="mb-2 text-xs text-ink-45">{note}</p> : null}
      {isEmpty ? (
        <div className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">
          {t('admin.dashboard.noData')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-white">{children}</div>
      )}
    </div>
  );
}
