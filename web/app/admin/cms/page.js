import Image from 'next/image';
import { getAdvertisements } from '@/lib/cms';
import { adImage, adPlacement } from '@/lib/cmsAdRules';
import { getCdfRate } from '@/lib/currencyRate';
import { updateAdvertisementAction, updateExchangeRateAction } from './actions';
import { getDictionary, getT } from '@/lib/i18n/server';
import { createTranslator } from '@/lib/i18n/translate';
import { LOCALES } from '@/lib/i18n/config';
import { getHeroSettingsRow } from '@/lib/cmsSettings';
import { getSeoSettingsForAdmin } from '@/lib/siteSettings';
import { seoFromStored } from '@/lib/siteSettingsRules';
import { formatKinshasa } from '../LeadRoutingUI';
import HeroManager from './HeroManager';
import SeoPanel from './SeoPanel';

// See web/app/admin/dashboard/page.js's identical comment — this page has
// no searchParams/cookies() of its own, so without this it would statically
// prerender at build time despite querying live-editable CMS rows.
export const dynamic = 'force-dynamic';

const FIELD_LABEL = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45';
const SAVE_BUTTON = 'rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas-alt';

/**
 * /admin/cms (`cms.manage`): the homepage hero image, the default SEO
 * metadata, the display exchange rate and the Laravel ad banners.
 *
 * The "Bannières d'accueil (sliders)" section is gone (2026-10-27): it edited
 * the old Laravel storefront's taglines, which lukkaplace.com never renders
 * (lib/cms.js).
 */
export default async function AdminCmsPage() {
  const t = await getT();
  const [advertisements, exchangeRate, heroRow, seoRow] = await Promise.all([
    getAdvertisements(),
    getCdfRate(),
    // Before migrations/20260921_cms_settings.sql runs the table is missing;
    // the section still renders, on the built-in photo.
    getHeroSettingsRow().catch(() => null),
    getSeoSettingsForAdmin().catch(() => null),
  ]);

  // The dictionary's text in each language — the placeholder of an empty
  // field, and what the site keeps using while it stays empty.
  const seoDefaults = Object.fromEntries(LOCALES.map((locale) => {
    const tl = createTranslator({ locale, messages: getDictionary(locale) });
    return [locale, { title: tl('site.metaTitle'), description: tl('site.metaDescription') }];
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.nav.cms')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-45">{t('admin.cms.subtitle')}</p>
      </div>

      <section>
        <h2 className="u-title-card mb-1 text-ink">{t('admin.cms.hero.title')}</h2>
        <p className="mb-3 max-w-2xl text-xs text-ink-45">{t('admin.cms.hero.subtitle')}</p>
        <HeroManager
          current={heroRow?.hero || null}
          updatedLabel={heroRow?.updatedAt ? t('admin.cms.hero.updated', { time: formatKinshasa(heroRow.updatedAt), actor: heroRow.updatedBy || '—' }) : ''}
          headline={t('home.hero.title')}
          subheadline={t('home.hero.subtitle')}
        />
      </section>

      <section>
        <h2 className="u-title-card mb-1 text-ink">{t('admin.cms.seo.heading')}</h2>
        <p className="mb-3 max-w-2xl text-xs text-ink-45">{t('admin.cms.seo.subtitle')}</p>
        {seoRow ? null : <p role="alert" className="u-micro mb-2 text-danger">{t('admin.cms.seo.unavailable')}</p>}
        <SeoPanel
          seo={seoRow?.seo || seoFromStored(null)}
          defaults={seoDefaults}
          updatedLabel={seoRow?.updatedAt ? t('admin.cms.hero.updated', { time: formatKinshasa(seoRow.updatedAt), actor: seoRow.updatedBy || '—' }) : ''}
        />
      </section>

      <section>
        <h2 className="u-title-card mb-1 text-ink">{t('admin.cms.exchangeRate')}</h2>
        <p className="mb-3 max-w-2xl text-xs text-ink-45">{t('admin.cms.rateNote')}</p>
        <form action={updateExchangeRateAction} className="flex flex-wrap items-end gap-2.5 rounded-card border border-line bg-white p-4">
          <div>
            <label htmlFor="cdf_per_usd" className={FIELD_LABEL}>
              {t('admin.cms.rateLabel')}
            </label>
            <input
              id="cdf_per_usd"
              name="cdf_per_usd"
              type="number"
              step="1"
              min="1"
              defaultValue={exchangeRate.cdfPerUsd}
              className="w-40 rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink"
            />
          </div>
          <button type="submit" className={SAVE_BUTTON}>
            {t('common.actions.save')}
          </button>
          <p className="pb-2 text-xs text-ink-45">{t('admin.cms.rateUpdated', { date: exchangeRate.updatedAt })}</p>
        </form>
      </section>

      <section>
        <h2 className="u-title-card mb-1 text-ink">{t('admin.cms.adBanners')}</h2>
        <p className="mb-3 max-w-2xl text-xs text-ink-45">{t('admin.cms.ads.note')}</p>
        <div className="overflow-x-auto rounded-card border border-line bg-white">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
              <tr>
                <th className="px-4 py-2.5 font-semibold">{t('admin.cms.ads.placement')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('admin.cms.ads.image')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('admin.cms.ads.views')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('admin.cms.ads.url')}</th>
              </tr>
            </thead>
            <tbody>
              {advertisements.map((ad) => {
                const bound = updateAdvertisementAction.bind(null, ad.id);
                const placement = adPlacement(ad);
                const image = adImage(ad.image);
                return (
                  <tr key={ad.id} className="border-b border-line align-middle last:border-b-0">
                    <td className="px-4 py-2.5">
                      <span className="block whitespace-nowrap font-medium text-ink">{t(placement.labelKey, placement.vars)}</span>
                      <span className="u-micro text-ink-45">{t('admin.cms.ads.rowId', { id: ad.id })}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {image.src ? (
                        <span className="relative block h-12 w-20 overflow-hidden rounded-md border border-line bg-canvas-alt">
                          <Image src={image.src} alt={t('admin.cms.ads.imageAlt', { id: ad.id })} fill sizes="80px" className="object-contain" />
                        </span>
                      ) : image.file ? (
                        <span className="u-micro block max-w-[11rem] text-ink-45" title={image.file}>
                          {t('admin.cms.ads.imageMissing', { file: image.file })}
                        </span>
                      ) : (
                        <span className="u-micro text-ink-45">{t('admin.cms.ads.noImage')}</span>
                      )}
                    </td>
                    <td className="u-tabular px-4 py-2.5 text-ink-70">{ad.views ?? 0}</td>
                    <td className="px-4 py-2.5">
                      <form action={bound} className="flex items-center gap-1.5">
                        <label htmlFor={`ad-url-${ad.id}`} className="sr-only">{t('admin.cms.ads.urlAria', { id: ad.id })}</label>
                        <input
                          id={`ad-url-${ad.id}`}
                          name="url"
                          type="url"
                          inputMode="url"
                          defaultValue={ad.url || ''}
                          placeholder="https://…"
                          className="w-64 rounded-md border border-line bg-white px-2 py-1 text-xs text-ink"
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-canvas-alt"
                        >
                          {t('common.actions.save')}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
