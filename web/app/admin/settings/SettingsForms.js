'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { FEATURE_FLAGS, SOCIAL_NETWORKS, UNHIDEABLE_ADMIN_TABS } from '@/lib/siteSettingsRules';
import { ADMIN_NAV_GROUPS } from '@/lib/adminNav';
import { saveFeatureFlagsAction, saveSocialLinksAction } from './actions';

const INPUT = 'u-micro h-9 w-full rounded-lg border border-line bg-surface px-3 text-ink focus:border-blue focus:outline-none';
const BUTTON = 'u-press u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue px-3 text-white hover:bg-blue-deep disabled:opacity-50';
const CARD = 'rounded-card border border-line bg-white p-4 sm:p-5';

function Message({ message }) {
  if (!message) return null;
  return (
    <p role={message.tone === 'error' ? 'alert' : 'status'} className={`u-micro ${message.tone === 'error' ? 'text-danger' : 'text-success'}`}>
      {message.text}
    </p>
  );
}

function useSave(action) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState(null);
  const [field, setField] = useState(null);
  function submit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      let result;
      try {
        result = await action(formData);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      setField(result?.ok ? null : result?.field || null);
      setMessage(result?.ok ? { tone: 'success', text: result.message } : { tone: 'error', text: result?.error || t('errors.actionFailed') });
      if (result?.ok) router.refresh();
    });
  }
  return { pending, message, field, submit };
}

/**
 * /admin/settings: the footer's social links and the feature flags.
 * Saved values are live on the next page load (memoised 30 s, dropped on save).
 */
export default function SettingsForms({ social, envSocial, features, socialUpdated, featuresUpdated }) {
  const t = useT();
  const socialSave = useSave(saveSocialLinksAction);
  const featureSave = useSave(saveFeatureFlagsAction);

  return (
    <>
      <section>
        <h2 className="u-title-card mb-1 text-ink">{t('admin.settings.social.title')}</h2>
        <p className="mb-3 max-w-2xl text-xs text-ink-45">{t('admin.settings.social.subtitle')}</p>
        <form onSubmit={socialSave.submit} className={`${CARD} grid gap-4 sm:grid-cols-2`}>
          {SOCIAL_NETWORKS.map(({ key, label }) => (
            <div key={key}>
              <label htmlFor={`social-${key}`} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
                {label}
              </label>
              <input
                id={`social-${key}`}
                name={key}
                type="url"
                inputMode="url"
                defaultValue={social[key] || ''}
                placeholder={t(`admin.settings.social.placeholders.${key}`)}
                aria-invalid={socialSave.field === key || undefined}
                className={`${INPUT} ${socialSave.field === key ? 'border-danger' : ''}`}
              />
              {!social[key] && envSocial[key] ? (
                <p className="u-micro mt-1 text-ink-45">{t('admin.settings.social.fromEnv', { url: envSocial[key] })}</p>
              ) : null}
              {key === 'whatsapp' ? <p className="u-micro mt-1 text-ink-45">{t('admin.settings.social.whatsappHint')}</p> : null}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button type="submit" disabled={socialSave.pending} className={BUTTON}>
              <Save className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
              {t('common.actions.save')}
            </button>
            <Message message={socialSave.message} />
            {socialUpdated ? <span className="u-micro text-ink-35">{socialUpdated}</span> : null}
          </div>
        </form>
      </section>

      <section>
        <h2 className="u-title-card mb-1 text-ink">{t('admin.settings.features.title')}</h2>
        <p className="mb-3 max-w-2xl text-xs text-ink-45">{t('admin.settings.features.subtitle')}</p>
        <form onSubmit={featureSave.submit} className={`${CARD} space-y-6`}>
          <fieldset className="space-y-4">
            <legend className="u-title-sub mb-3 text-ink">{t('admin.settings.features.siteGroup')}</legend>
            {FEATURE_FLAGS.map(({ key, surface }) => (
              <label key={key} className="flex items-start gap-3">
                <input type="checkbox" name={key} defaultChecked={features[key]} className="mt-1 h-4 w-4 accent-blue" />
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    {t(`admin.settings.features.${key}`)}
                    <span className="u-micro ml-2 font-normal text-ink-45">{t(`admin.settings.features.surface.${surface}`)}</span>
                  </span>
                  <span className="u-micro block text-ink-45">{t(`admin.settings.features.${key}Hint`)}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend className="u-title-sub mb-1 text-ink">{t('admin.settings.features.adminGroup')}</legend>
            <p className="u-micro mb-3 max-w-2xl text-ink-45">{t('admin.settings.features.adminGroupHint')}</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {ADMIN_NAV_GROUPS.map((group) => (
                <div key={group.labelKey}>
                  <div className="u-eyebrow mb-2">{t(group.labelKey)}</div>
                  <ul className="space-y-1.5">
                    {group.items.map(({ href, labelKey }) => {
                      const locked = UNHIDEABLE_ADMIN_TABS.includes(href);
                      return (
                        <li key={href}>
                          <label className={`flex items-center gap-2.5 text-sm ${locked ? 'text-ink-45' : 'text-ink'}`}>
                            <input
                              type="checkbox"
                              name={`tab:${href}`}
                              defaultChecked={locked || !features.hiddenAdminTabs.includes(href)}
                              disabled={locked}
                              className="h-4 w-4 accent-blue"
                            />
                            {t(labelKey)}
                            {locked ? <span className="u-micro text-ink-35">{t('admin.settings.features.alwaysVisible')}</span> : null}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={featureSave.pending} className={BUTTON}>
              <Save className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
              {t('common.actions.save')}
            </button>
            <Message message={featureSave.message} />
            {featuresUpdated ? <span className="u-micro text-ink-35">{featuresUpdated}</span> : null}
          </div>
        </form>
      </section>
    </>
  );
}
