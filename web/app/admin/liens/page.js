import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { firstParam } from '@/lib/adminPagination';
import { CAMPAIGN_MEDIUMS, CAMPAIGN_SOURCES, DEFAULT_CAMPAIGN, buildCampaignLink } from '@/lib/campaignLinks';
import { qrSvg } from '@/lib/marketing/printSheetData';
import { SITE_URL } from '@/lib/constants';
import { ErrorNote } from '../LeadRoutingUI';
import { BUTTON, BUTTON_PRIMARY, INPUT } from '../sales/styles';
import CopyLink from './CopyLink';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Liens de campagne — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

const ERRORS = {
  destination: 'admin.links.errors.destination',
  source: 'admin.links.errors.source',
  medium: 'admin.links.errors.medium',
};

/**
 * Growth plan item 4: a tagged link and its QR code for any ad, post, flyer
 * or radio spot, so every campaign reaches the dashboard under one name
 * (lib/campaignLinks.js has the vocabulary). A plain GET form: the link is in
 * the page's own URL, so it can be bookmarked or sent to a colleague. Nothing
 * is stored — the tags travel in the link, and lib/attribution.js records them
 * when someone opens it.
 */
export default async function AdminLinksPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const fields = {
    destination: String(firstParam(raw.destination) || '').slice(0, 300),
    source: String(firstParam(raw.source) || ''),
    medium: String(firstParam(raw.medium) || ''),
    campaign: String(firstParam(raw.campaign) || DEFAULT_CAMPAIGN).slice(0, 80),
    content: String(firstParam(raw.content) || '').slice(0, 80),
    ref: String(firstParam(raw.ref) || '').slice(0, 20),
  };
  const submitted = Boolean(firstParam(raw.source));
  const built = submitted ? buildCampaignLink(fields, { siteUrl: SITE_URL }) : null;
  const qr = built?.ok ? await qrSvg(built.url).catch(() => null) : null;
  const qrHref = qr ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}` : null;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.links.title')}</h1>
        <p className="u-micro mt-1 max-w-[75ch] text-ink-45">{t('admin.links.lead')}</p>
      </div>

      <form action="/admin/liens" className="u-card grid gap-3 rounded-card bg-surface p-4 sm:grid-cols-2">
        <label className="u-micro-strong flex flex-col gap-1 text-ink-70 sm:col-span-2">
          {t('admin.links.destination')}
          <input name="destination" defaultValue={fields.destination} placeholder={t('admin.links.destinationPlaceholder')} className={INPUT} />
          <span className="u-micro font-normal text-ink-45">{t('admin.links.destinationHint')}</span>
        </label>
        <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
          {t('admin.links.source')}
          <select name="source" defaultValue={fields.source || 'facebook'} className={INPUT}>
            {CAMPAIGN_SOURCES.map((value) => (
              <option key={value} value={value}>{t(`admin.links.sources.${value}`)}</option>
            ))}
          </select>
        </label>
        <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
          {t('admin.links.medium')}
          <select name="medium" defaultValue={fields.medium} className={INPUT}>
            <option value="">{t('admin.links.none')}</option>
            {CAMPAIGN_MEDIUMS.map((value) => (
              <option key={value} value={value}>{t(`admin.links.mediums.${value}`)}</option>
            ))}
          </select>
        </label>
        <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
          {t('admin.links.campaign')}
          <input name="campaign" defaultValue={fields.campaign} className={INPUT} />
        </label>
        <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
          {t('admin.links.content')}
          <input name="content" defaultValue={fields.content} placeholder={t('admin.links.contentPlaceholder')} className={INPUT} />
        </label>
        <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
          {t('admin.links.ref')}
          <input name="ref" defaultValue={fields.ref} placeholder="NADIA01" className={`${INPUT} uppercase`} />
          <span className="u-micro font-normal text-ink-45">{t('admin.links.refHint')}</span>
        </label>
        <div className="flex items-end">
          <button type="submit" className={BUTTON_PRIMARY}>{t('admin.links.build')}</button>
        </div>
      </form>

      {built && !built.ok ? <ErrorNote>{t(ERRORS[built.error])}</ErrorNote> : null}

      {built?.ok ? (
        <section className="u-card grid gap-4 rounded-card bg-surface p-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <div className="flex min-w-0 flex-col gap-2">
            <h2 className="u-title-card text-ink">{t('admin.links.result')}</h2>
            <CopyLink url={built.url} />
            <p className="u-micro text-ink-45">{t('admin.links.resultHint')}</p>
          </div>
          {qrHref ? (
            <div className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URI, nothing to optimise */}
              <img src={qrHref} alt={t('admin.links.qrAlt')} width={160} height={160} className="h-40 w-40 rounded-md border border-line bg-white" />
              <a href={qrHref} download={`lukka-place-${built.tags.campaign}.svg`} className={BUTTON}>{t('admin.links.downloadQr')}</a>
            </div>
          ) : null}
        </section>
      ) : null}

      <p className="u-micro text-ink-45">
        {t('admin.links.partnersNote')}{' '}
        <Link href="/admin/partenaires" className="font-semibold text-blue-deep hover:underline">{t('admin.links.partnersLink')}</Link>
      </p>
    </div>
  );
}
