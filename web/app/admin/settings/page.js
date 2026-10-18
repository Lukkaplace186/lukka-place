import { getSiteSettingsForAdmin } from '@/lib/siteSettings';
import { socialProfiles } from '@/lib/seoSchema';
import { getT } from '@/lib/i18n/server';
import { formatKinshasa } from '../LeadRoutingUI';
import SettingsForms from './SettingsForms';

// Live-editable rows, read per request.
export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  const t = await getT();
  let settings = null;
  let loadError = null;
  try {
    settings = await getSiteSettingsForAdmin();
  } catch (err) {
    loadError = err.message;
  }
  const stamp = (at, by) => (at ? t('admin.settings.updated', { time: formatKinshasa(at), actor: by || '—' }) : '');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.nav.settings')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-45">{t('admin.settings.subtitle')}</p>
      </div>
      {loadError ? (
        <p role="alert" className="rounded-card border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
          {t('admin.settings.loadError')}
        </p>
      ) : (
        <SettingsForms
          social={settings.social}
          envSocial={socialProfiles()}
          features={settings.features}
          socialUpdated={stamp(settings.socialUpdatedAt, settings.socialUpdatedBy)}
          featuresUpdated={stamp(settings.featuresUpdatedAt, settings.featuresUpdatedBy)}
        />
      )}
    </div>
  );
}
