import { getGrowthSettingsForAdmin, getSiteSettingsForAdmin } from '@/lib/siteSettings';
import { socialProfiles } from '@/lib/seoSchema';
import { getT } from '@/lib/i18n/server';
import { formatKinshasa } from '../LeadRoutingUI';
import SettingsForms from './SettingsForms';
import { BUTTON_PRIMARY, INPUT } from '../sales/styles';
import { saveGrowthSettingsAction } from './growthActions';

// Live-editable rows, read per request.
export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  let settings = null;
  let growth = null;
  let loadError = null;
  try {
    [settings, growth] = await Promise.all([getSiteSettingsForAdmin(), getGrowthSettingsForAdmin()]);
  } catch (err) {
    loadError = err.message;
  }
  const growthError = typeof raw.growth_error === 'string' ? raw.growth_error : null;
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

      {growth ? (
        <section id="croissance" className="u-card flex max-w-2xl flex-col gap-3 rounded-card bg-surface p-4 sm:p-5">
          <div>
            <h2 className="u-title-card text-ink">{t('admin.settings.growth.title')}</h2>
            <p className="u-micro mt-1 text-ink-45">{t('admin.settings.growth.lead')}</p>
          </div>
          {raw.growth_saved ? <p className="u-micro-strong rounded-lg bg-success-tint px-3 py-2 text-success" role="status">{t('admin.settings.saved')}</p> : null}
          {growthError ? <p className="u-micro-strong rounded-lg bg-danger-tint px-3 py-2 text-danger" role="alert">{t(`admin.settings.growth.errors.${growthError === 'meta' || growthError === 'tiktok' || growthError === 'cutoff' ? growthError : 'failed'}`)}</p> : null}
          <form action={saveGrowthSettingsAction} className="grid gap-3 sm:grid-cols-2">
            <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
              {t('admin.settings.growth.meta')}
              <input name="metaPixelId" inputMode="numeric" defaultValue={growth.stored.metaPixelId || ''} placeholder={growth.effective.metaPixelId || '123456789012345'} className={INPUT} />
            </label>
            <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
              {t('admin.settings.growth.tiktok')}
              <input name="tiktokPixelId" defaultValue={growth.stored.tiktokPixelId || ''} placeholder={growth.effective.tiktokPixelId || 'C1234567890ABCDEFGHIJ'} className={`${INPUT} uppercase`} />
            </label>
            <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
              {t('admin.settings.growth.cutoff')}
              <input type="date" name="founderCutoff" defaultValue={growth.stored.founderCutoff} className={INPUT} />
            </label>
            <div className="u-micro flex flex-col justify-end gap-1 text-ink-45">
              <span>{t('admin.settings.growth.serverMeta', { state: growth.serverEvents.meta ? t('admin.settings.growth.on') : t('admin.settings.growth.off') })}</span>
              <span>{t('admin.settings.growth.serverTiktok', { state: growth.serverEvents.tiktok ? t('admin.settings.growth.on') : t('admin.settings.growth.off') })}</span>
            </div>
            <p className="u-micro text-ink-45 sm:col-span-2">{t('admin.settings.growth.tokensHint')}</p>
            <div className="flex items-center gap-3 sm:col-span-2">
              <button type="submit" className={BUTTON_PRIMARY}>{t('common.actions.save')}</button>
              <span className="u-micro text-ink-45">{stamp(growth.updatedAt, growth.updatedBy)}</span>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
