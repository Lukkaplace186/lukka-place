import { notFound } from 'next/navigation';
import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { listRecentFacebookProspects } from '@/lib/facebookProspects';
import { getLocale, getT } from '@/lib/i18n/server';
import PastePostForm from './PastePostForm';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Coller une publication — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

const STATUS_KEYS = {
  pending_invite: 'admin.facebookProspects.status.pending_invite',
  invited: 'admin.facebookProspects.status.invited',
  registered: 'admin.facebookProspects.status.registered',
  declined: 'admin.facebookProspects.status.declined',
};

function formatWhen(value, locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kinshasa',
  }).format(date);
}

/**
 * "Coller une publication" — a team member who is in the Facebook groups
 * pastes a post; its Congolese numbers become agent prospects
 * (facebook_prospects, exported with `npm run export:leads`). Nobody is
 * messaged from here.
 */
export default async function PasteFacebookPostPage() {
  const t = await getT();
  const locale = await getLocale();
  const session = await getAdminSession();
  if (!can(session?.role, 'agents.manage')) notFound();

  const recent = await listRecentFacebookProspects(15);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.facebookProspects.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.facebookProspects.subtitle')}</p>
      </div>

      {recent.available ? (
        <PastePostForm />
      ) : (
        <p role="alert" className="u-micro rounded-lg bg-warning-tint px-3.5 py-3 text-ink-70">
          {t('admin.facebookProspects.errorUnavailable')}
        </p>
      )}

      {recent.available ? (
        <section className="u-card flex flex-col gap-3 rounded-card bg-surface p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="u-title-card text-ink">{t('admin.facebookProspects.recentTitle')}</h2>
            <p className="u-micro text-ink-45">
              {t('admin.facebookProspects.pendingTotal', { count: recent.pendingTotal })} · <code className="u-ref">npm run export:leads</code>
            </p>
          </div>
          {recent.rows.length ? (
            <ul className="divide-y divide-line">
              {recent.rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
                  <div className="min-w-0">
                    <p className="u-micro-strong u-tabular text-ink">+{row.phone}</p>
                    <p className="u-micro truncate text-ink-45">
                      {[row.author_name, row.group_name].filter(Boolean).join(' · ') || '—'}
                      {row.seen_count > 1 ? ` · ${t('admin.facebookProspects.seenCount', { count: row.seen_count })}` : ''}
                    </p>
                  </div>
                  <div className="u-micro flex items-center gap-3 text-ink-45">
                    {row.post_url ? (
                      <a href={row.post_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-deep hover:underline">
                        {t('admin.facebookProspects.openPost')}
                      </a>
                    ) : null}
                    <span>{t(STATUS_KEYS[row.status] || STATUS_KEYS.pending_invite)}</span>
                    <span className="u-tabular">{formatWhen(row.created_at, locale)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="u-micro text-ink-45">{t('admin.facebookProspects.empty')}</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
