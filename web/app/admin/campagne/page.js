import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { frNumber } from '@/lib/format';
import { firstParam } from '@/lib/adminPagination';
import { getReferralCampaign } from '@/lib/siteSettings';
import { announcementTemplateName, announcementText, getAnnouncementStats } from '@/lib/referralAnnouncement';
import { ErrorNote, formatKinshasa } from '../LeadRoutingUI';
import { BUTTON, BUTTON_PRIMARY } from '../sales/styles';
import { setCampaignAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Campagne — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

const CARD = 'rounded-card border border-line bg-white p-4 sm:p-5';
const FLASH = { campaignStarted: 'success', campaignStopped: 'success', failed: 'danger' };
const CHANNEL_KEYS = { session: 'channelSession', template: 'channelTemplate', on_write: 'channelOnWrite' };
// The preview's sample agent — the template's own review samples.
const SAMPLE = { firstName: 'Charly', inviteLink: 'https://lukkaplace.com/i/CHARLY01' };

/**
 * /admin/campagne — the agent announcement campaign in one place: its state
 * and the Stop / Restart switch (owner), how the message goes out, the exact
 * text, and how many agents it reached. The credits ledger stays on
 * /admin/partenaires/agents.
 */
export default async function CampaignPage({ searchParams }) {
  const t = await getT();
  const raw = await searchParams;
  const session = await getAdminSession();
  const canManage = can(session?.role, 'partners.manage');
  const campaign = await getReferralCampaign();
  const template = announcementTemplateName();

  let stats = null;
  let loadError = null;
  try {
    stats = await getAnnouncementStats();
  } catch (err) {
    loadError = err.message;
  }

  const flashKey = firstParam(raw?.flash);
  const flashTone = FLASH[flashKey];

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.campaign.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.campaign.lead')}</p>
      </div>

      {flashTone ? (
        <p
          className={`u-micro-strong rounded-lg px-3.5 py-2.5 ${flashTone === 'success' ? 'bg-success-tint text-success' : 'bg-danger-tint text-danger'}`}
          role={flashTone === 'success' ? 'status' : 'alert'}
        >
          {t(`admin.campaign.flash.${flashKey}`)}
        </p>
      ) : null}

      <section className={`${CARD} flex flex-col gap-3`}>
        <p className={`u-micro-strong ${campaign.active ? 'text-success' : 'text-ink'}`} role="status">
          {t(campaign.active ? 'admin.campaign.statusActive' : 'admin.campaign.statusStopped')}
        </p>
        <p className="u-micro text-ink-45">
          {campaign.updatedAt
            ? t('admin.campaign.changed', { time: formatKinshasa(campaign.updatedAt), by: campaign.updatedBy || '—' })
            : t('admin.campaign.neverChanged')}
        </p>
        {canManage ? (
          <form action={setCampaignAction}>
            <input type="hidden" name="active" value={campaign.active ? '0' : '1'} />
            <button type="submit" className={campaign.active ? BUTTON : BUTTON_PRIMARY}>
              {t(campaign.active ? 'admin.campaign.stop' : 'admin.campaign.start')}
            </button>
          </form>
        ) : (
          <p className="u-micro text-ink-45">{t('admin.campaign.ownerOnly')}</p>
        )}
      </section>

      <section className={`${CARD} flex flex-col gap-2`}>
        <h2 className="u-title-card text-ink">{t('admin.campaign.howTitle')}</h2>
        <ul className="u-micro flex list-disc flex-col gap-1 pl-5 text-ink-70">
          <li>{t('admin.campaign.howButton')}</li>
          <li>{t('admin.campaign.howOnWrite')}</li>
        </ul>
        <p className="u-micro text-ink-70">
          {template ? t('admin.campaign.templateSet', { name: template }) : t('admin.campaign.templateUnset')}
        </p>
      </section>

      <section className={`${CARD} flex flex-col gap-2`}>
        <h2 className="u-title-card text-ink">{t('admin.campaign.messageTitle')}</h2>
        <p className="u-micro text-ink-45">{t('admin.campaign.messageNote')}</p>
        <pre className="u-micro whitespace-pre-wrap rounded-lg bg-canvas-alt p-3.5 font-sans text-ink">{announcementText(SAMPLE)}</pre>
      </section>

      <section className={`${CARD} flex flex-col gap-2`}>
        <h2 className="u-title-card text-ink">{t('admin.campaign.statsTitle')}</h2>
        {loadError ? <ErrorNote>{loadError}</ErrorNote> : null}
        {stats && !stats.available ? <p className="u-micro text-ink-45">{t('admin.campaign.statsUnavailable')}</p> : null}
        {stats?.available ? (
          <dl className="u-micro grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-ink-70">
            <dt>{t('admin.campaign.sent')}</dt>
            <dd className="u-tabular font-semibold text-ink">
              {frNumber(stats.sent)}
              {stats.sent > 0
                ? ` (${Object.entries(stats.byChannel)
                  .map(([channel, n]) => `${frNumber(n)} ${t(`admin.campaign.${CHANNEL_KEYS[channel] || 'channelSession'}`)}`)
                  .join(' · ')})`
                : ''}
            </dd>
            <dt>{t('admin.campaign.remaining')}</dt>
            <dd className="u-tabular font-semibold text-ink">{frNumber(stats.remaining)}</dd>
          </dl>
        ) : null}
        <Link href="/admin/partenaires/agents" className="u-micro-strong text-blue-deep hover:underline">
          {t('admin.campaign.ledgerLink')}
        </Link>
      </section>
    </div>
  );
}
