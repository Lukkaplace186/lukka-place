import Link from 'next/link';
import { CheckCircle2, CircleAlert, CircleX, ExternalLink } from 'lucide-react';
import { ICON_STROKE_WIDTH, SITE_URL } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { getSeoFacets } from '@/lib/listings';
import { getSocialLinks } from '@/lib/siteSettings';
import { mergeSocialLinks } from '@/lib/siteSettingsRules';
import { sameAsProfiles, socialProfiles } from '@/lib/seoSchema';
import { getSearchConsoleReport } from '@/lib/searchConsole';
import { getDomainVerification, getListingSeoQuality, getSitemapSummary } from '@/lib/seoAudit';
import {
  TARGET_SEARCHES, THIN_PAGE_MAX, communeCoverage, countForFacet, coverageSummary, matchTargetRows,
  pathForFacet, percentOf, resultsPage,
} from '@/lib/seoAuditRules';
import { toEnglishPath } from '@/lib/localePaths';
import { Chip, ErrorNote, Panel, Stat, TD, TD_RIGHT, TH, TH_RIGHT } from '../LeadRoutingUI';

export const metadata = {
  title: 'SEO & Google — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const SITE = SITE_URL.replace(/\/+$/, '');
const LINK = 'font-semibold text-blue hover:underline';

function StatusIcon({ level }) {
  if (level === 'ok') return <CheckCircle2 strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 shrink-0 text-success" />;
  if (level === 'warn') return <CircleAlert strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 shrink-0 text-warning" />;
  return <CircleX strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 shrink-0 text-danger" />;
}

function External({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${LINK} inline-flex items-center gap-1`}>
      {children}
      <ExternalLink strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
    </a>
  );
}

function fmtPosition(position) {
  return Number.isFinite(position) ? position.toFixed(1).replace('.', ',') : '—';
}

const nf = new Intl.NumberFormat('fr-FR');

/**
 * SEO & Google: what stands between lukkaplace.com and page one for
 * "appartement à louer Kinshasa" / "apartment for rent Kinshasa".
 *
 * Four sources, each read live and each allowed to fail alone: the domain's
 * DNS (is the Search Console record there), the sitemap function itself, our
 * own listings (landing-page coverage and listing quality), and — once a
 * service account is connected — Search Console's real queries and positions
 * (lib/searchConsole.js). Nothing is estimated: without Search Console the
 * position column says "not connected", never a guess.
 */
export default async function AdminSeoPage() {
  const t = await getT();
  const [dnsCheck, sitemap, facetsResult, quality, gsc, savedSocial] = await Promise.all([
    getDomainVerification(),
    getSitemapSummary(),
    getSeoFacets().then((value) => ({ ok: true, value })).catch((err) => ({ ok: false, error: err.message })),
    getListingSeoQuality().then((value) => ({ ok: true, value })).catch((err) => ({ ok: false, error: err.message })),
    getSearchConsoleReport({ days: 28 }),
    getSocialLinks(),
  ]);
  const facets = facetsResult.ok ? facetsResult.value : [];
  const coverage = communeCoverage(facets);
  const coverageTotals = coverageSummary(coverage);
  const profiles = sameAsProfiles(mergeSocialLinks(savedSocial, socialProfiles()));
  const gscRows = gsc.ok ? gsc.queries : [];
  // English twins listed in the sitemap (lib/localePaths.js, app/sitemap.js).
  const englishPages = sitemap.ok ? sitemap.bySection['/en'] || 0 : 0;

  const checks = [
    {
      key: 'dns',
      level: !dnsCheck.ok ? 'down' : dnsCheck.google > 0 ? 'ok' : 'down',
      detail: !dnsCheck.ok ? dnsCheck.error : dnsCheck.google > 0 ? t('admin.seoAudit.checks.dnsOk') : t('admin.seoAudit.checks.dnsMissing'),
      action: <External href="https://search.google.com/search-console">Search Console</External>,
    },
    {
      key: 'gsc',
      level: gsc.ok ? 'ok' : gsc.configured ? 'down' : 'warn',
      detail: gsc.ok
        ? t('admin.seoAudit.checks.gscOk', { property: gsc.property })
        : gsc.configured ? t('admin.seoAudit.checks.gscError', { error: gsc.error }) : t('admin.seoAudit.checks.gscMissing'),
      action: <a href="#search-console" className={LINK}>{t('admin.seoAudit.checks.howTo')}</a>,
    },
    {
      key: 'sitemap',
      level: !sitemap.ok ? 'down' : gsc.ok && !gsc.sitemaps?.length ? 'warn' : 'ok',
      detail: !sitemap.ok
        ? sitemap.error
        : gsc.ok && !gsc.sitemaps?.length
          ? t('admin.seoAudit.checks.sitemapNotSubmitted', { count: nf.format(sitemap.total) })
          : t('admin.seoAudit.checks.sitemapOk', { count: nf.format(sitemap.total) }),
      action: <External href={`${SITE}/sitemap.xml`}>sitemap.xml</External>,
    },
    {
      key: 'english',
      level: englishPages > 0 ? 'ok' : 'down',
      detail: englishPages > 0 ? t('admin.seoAudit.checks.englishOk', { count: nf.format(englishPages) }) : t('admin.seoAudit.checks.englishMissing'),
      action: englishPages > 0 ? <External href={`${SITE}/en/rent/apartments`}>/en/rent/apartments</External> : null,
    },
    {
      key: 'social',
      level: profiles.length >= 2 ? 'ok' : 'warn',
      detail: profiles.length ? t('admin.seoAudit.checks.socialOk', { count: profiles.length }) : t('admin.seoAudit.checks.socialMissing'),
      action: <Link href="/admin/settings" className={LINK}>{t('admin.seoAudit.checks.settings')}</Link>,
    },
    {
      key: 'bing',
      level: dnsCheck.bing || process.env.BING_SITE_VERIFICATION ? 'ok' : 'warn',
      detail: dnsCheck.bing || process.env.BING_SITE_VERIFICATION ? t('admin.seoAudit.checks.bingOk') : t('admin.seoAudit.checks.bingMissing'),
      action: <External href="https://www.bing.com/webmasters">Bing Webmaster Tools</External>,
    },
  ];

  const qualityCounts = quality.ok ? quality.value.counts : null;
  const qualityRows = [
    { key: 'fewPhotos', count: qualityCounts?.few_photos, href: '/admin/listings?status=approved&flag=few_photos' },
    { key: 'noCommune', count: qualityCounts?.no_commune, href: '/admin/listings?status=approved&flag=missing_commune' },
    { key: 'noQuartier', count: qualityCounts?.no_quartier },
    { key: 'shortDescription', count: qualityCounts?.short_description },
    { key: 'landWithRooms', count: qualityCounts?.land_with_rooms },
    { key: 'noPrice', count: qualityCounts?.no_price, href: '/admin/listings?status=approved&flag=missing_price' },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="u-title-page text-ink">{t('admin.seoAudit.title')}</h1>
        <p className="u-micro mt-1 max-w-3xl text-ink-45">{t('admin.seoAudit.subtitle')}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('admin.seoAudit.stats.sitemap')} value={sitemap.ok ? nf.format(sitemap.total) : '—'} hint={t('admin.seoAudit.stats.sitemapHint')} />
        <Stat
          label={t('admin.seoAudit.stats.landing')}
          value={nf.format(coverageTotals.indexable)}
          hint={t('admin.seoAudit.stats.landingHint', { thin: coverageTotals.thin, empty: coverageTotals.empty })}
        />
        <Stat
          label={t('admin.seoAudit.stats.clicks')}
          value={gsc.ok ? nf.format(gsc.totals.clicks || 0) : '—'}
          hint={gsc.ok ? t('admin.seoAudit.stats.impressions', { count: nf.format(gsc.totals.impressions || 0) }) : t('admin.seoAudit.notConnected')}
        />
        <Stat
          label={t('admin.seoAudit.stats.position')}
          value={gsc.ok ? fmtPosition(gsc.totals.position) : '—'}
          hint={gsc.ok ? t('admin.seoAudit.stats.positionHint') : t('admin.seoAudit.notConnected')}
        />
      </div>

      <Panel title={t('admin.seoAudit.checks.title')} note={t('admin.seoAudit.checks.note')}>
        <ul className="divide-y divide-line">
          {checks.map((check) => (
            <li key={check.key} className="flex items-start gap-3 px-4 py-3">
              <StatusIcon level={check.level} />
              <div className="min-w-0 flex-1">
                <div className="u-micro-strong text-ink">{t(`admin.seoAudit.checks.${check.key}`)}</div>
                <div className="u-micro text-ink-45">{check.detail}</div>
              </div>
              {check.action ? <div className="u-micro shrink-0">{check.action}</div> : null}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={t('admin.seoAudit.targets.title')} note={t('admin.seoAudit.targets.note')}>
        <table className="w-full min-w-[48rem] border-collapse">
          <thead>
            <tr>
              <th className={TH}>{t('admin.seoAudit.targets.query')}</th>
              <th className={TH}>{t('admin.seoAudit.targets.page')}</th>
              <th className={TH_RIGHT}>{t('admin.seoAudit.targets.listings')}</th>
              <th className={TH_RIGHT}>{t('admin.seoAudit.targets.position')}</th>
              <th className={TH_RIGHT}>{t('admin.seoAudit.targets.impressions')}</th>
              <th className={TH_RIGHT}>{t('admin.seoAudit.targets.clicks')}</th>
            </tr>
          </thead>
          <tbody>
            {TARGET_SEARCHES.map((target) => {
              const path = target.lang === 'en' ? toEnglishPath(pathForFacet(target.facet)) : pathForFacet(target.facet);
              const listings = target.facet.purpose ? countForFacet(facets, target.facet) : null;
              const match = gsc.ok ? matchTargetRows(target.query, gscRows) : null;
              const page = resultsPage(match?.position);
              return (
                <tr key={target.query} className="border-b border-line last:border-0">
                  <td className={TD}>
                    <span className="mr-2"><Chip tone={target.lang === 'en' ? 'blue' : 'neutral'}>{target.lang.toUpperCase()}</Chip></span>
                    {target.query}
                  </td>
                  <td className={TD}>
                    {path ? (
                      <External href={`${SITE}${path}`}>{path}</External>
                    ) : (
                      <span className="text-danger">{t('admin.seoAudit.targets.noEnglishPage')}</span>
                    )}
                  </td>
                  <td className={TD_RIGHT}>
                    {listings == null ? '—' : listings <= THIN_PAGE_MAX ? <span className="text-warning">{listings}</span> : nf.format(listings)}
                  </td>
                  <td className={TD_RIGHT}>
                    {!gsc.ok ? '—' : match ? (
                      <span className={page === 1 ? 'font-bold text-success' : ''}>
                        {fmtPosition(match.position)} <span className="text-ink-45">({t('admin.seoAudit.targets.pageN', { page })})</span>
                      </span>
                    ) : <span className="text-ink-45">{t('admin.seoAudit.targets.notSeen')}</span>}
                  </td>
                  <td className={TD_RIGHT}>{match ? nf.format(match.impressions) : '—'}</td>
                  <td className={TD_RIGHT}>{match ? nf.format(match.clicks) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {gsc.ok ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title={t('admin.seoAudit.gsc.queries')} note={t('admin.seoAudit.gsc.range', gsc.range)} isEmpty={!gscRows.length} emptyText={t('admin.seoAudit.gsc.empty')}>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={TH}>{t('admin.seoAudit.targets.query')}</th>
                  <th className={TH_RIGHT}>{t('admin.seoAudit.targets.clicks')}</th>
                  <th className={TH_RIGHT}>{t('admin.seoAudit.targets.impressions')}</th>
                  <th className={TH_RIGHT}>{t('admin.seoAudit.targets.position')}</th>
                </tr>
              </thead>
              <tbody>
                {gscRows.slice(0, 25).map((row) => (
                  <tr key={row.keys[0]} className="border-b border-line last:border-0">
                    <td className={TD}>{row.keys[0]}</td>
                    <td className={TD_RIGHT}>{nf.format(row.clicks)}</td>
                    <td className={TD_RIGHT}>{nf.format(row.impressions)}</td>
                    <td className={TD_RIGHT}>{fmtPosition(row.position)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title={t('admin.seoAudit.gsc.pages')} note={t('admin.seoAudit.gsc.range', gsc.range)} isEmpty={!gsc.pages.length} emptyText={t('admin.seoAudit.gsc.empty')}>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={TH}>{t('admin.seoAudit.targets.page')}</th>
                  <th className={TH_RIGHT}>{t('admin.seoAudit.targets.clicks')}</th>
                  <th className={TH_RIGHT}>{t('admin.seoAudit.targets.impressions')}</th>
                  <th className={TH_RIGHT}>{t('admin.seoAudit.targets.position')}</th>
                </tr>
              </thead>
              <tbody>
                {gsc.pages.map((row) => (
                  <tr key={row.keys[0]} className="border-b border-line last:border-0">
                    <td className={`${TD} max-w-[22rem] truncate`}>{row.keys[0].replace(SITE, '') || '/'}</td>
                    <td className={TD_RIGHT}>{nf.format(row.clicks)}</td>
                    <td className={TD_RIGHT}>{nf.format(row.impressions)}</td>
                    <td className={TD_RIGHT}>{fmtPosition(row.position)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          {gsc.sitemaps?.length ? (
            <Panel title={t('admin.seoAudit.gsc.sitemaps')}>
              <ul className="divide-y divide-line">
                {gsc.sitemaps.map((entry) => (
                  <li key={entry.path} className="u-micro px-4 py-3 text-ink-70">
                    <span className="u-micro-strong text-ink">{entry.path}</span>
                    {' — '}
                    {t('admin.seoAudit.gsc.sitemapLine', {
                      submitted: nf.format(Number(entry.contents?.[0]?.submitted) || 0),
                      downloaded: entry.lastDownloaded ? entry.lastDownloaded.slice(0, 10) : '—',
                      errors: Number(entry.errors) || 0,
                      warnings: Number(entry.warnings) || 0,
                    })}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      ) : (
        <section id="search-console" className="u-card space-y-3 rounded-card bg-surface p-5">
          <h2 className="u-title-card text-ink">{t('admin.seoAudit.connect.title')}</h2>
          {gsc.configured ? <ErrorNote>{t('admin.seoAudit.checks.gscError', { error: gsc.error })}</ErrorNote> : null}
          <p className="u-micro text-ink-70">{t('admin.seoAudit.connect.intro')}</p>
          <ol className="u-micro list-decimal space-y-1.5 pl-5 text-ink-70">
            {['1', '2', '3', '4', '5'].map((step) => <li key={step}>{t(`admin.seoAudit.connect.step${step}`)}</li>)}
          </ol>
        </section>
      )}

      <Panel
        title={t('admin.seoAudit.coverage.title')}
        note={t('admin.seoAudit.coverage.note', { max: THIN_PAGE_MAX })}
        isEmpty={!facetsResult.ok}
        emptyText={facetsResult.error}
      >
        <table className="w-full min-w-[36rem] border-collapse">
          <thead>
            <tr>
              <th className={TH}>{t('admin.seoAudit.coverage.commune')}</th>
              <th className={TH_RIGHT}>{t('admin.seoAudit.coverage.rent')}</th>
              <th className={TH_RIGHT}>{t('admin.seoAudit.coverage.sale')}</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map((row) => (
              <tr key={row.commune} className="border-b border-line last:border-0">
                <td className={TD}>{row.commune}</td>
                {[[row.rent, row.rentPath], [row.sale, row.salePath]].map(([n, path]) => (
                  <td key={path} className={TD_RIGHT}>
                    {n === 0 ? (
                      <span className="text-ink-35">{t('admin.seoAudit.coverage.none')}</span>
                    ) : (
                      <a href={`${SITE}${path}`} target="_blank" rel="noopener noreferrer" className={n <= THIN_PAGE_MAX ? 'font-semibold text-warning hover:underline' : LINK}>
                        {n}
                      </a>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel
        title={t('admin.seoAudit.quality.title')}
        note={qualityCounts ? t('admin.seoAudit.quality.note', { total: qualityCounts.total }) : null}
        isEmpty={!quality.ok}
        emptyText={quality.error}
      >
        <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
          {qualityRows.map((row) => (
            <div key={row.key} className="bg-surface p-4">
              <div className="u-eyebrow text-ink-45">{t(`admin.seoAudit.quality.${row.key}`)}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className={`u-stat ${row.count ? 'text-warning' : 'text-success'}`}>{row.count ?? '—'}</span>
                {qualityCounts ? <span className="u-micro text-ink-45">{percentOf(row.count || 0, qualityCounts.total)} %</span> : null}
              </div>
              {row.href && row.count ? <Link href={row.href} className={`u-micro ${LINK}`}>{t('admin.seoAudit.quality.open')}</Link> : null}
            </div>
          ))}
        </div>
        {quality.ok && quality.value.sample.length ? (
          <table className="w-full min-w-[44rem] border-collapse border-t border-line">
            <thead>
              <tr>
                <th className={TH}>#</th>
                <th className={TH}>{t('admin.seoAudit.quality.listing')}</th>
                <th className={TH}>{t('admin.seoAudit.quality.issues')}</th>
              </tr>
            </thead>
            <tbody>
              {quality.value.sample.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className={TD}><Link href={`/admin/listings/${row.id}`} className={LINK}>{row.id}</Link></td>
                  <td className={`${TD} max-w-[24rem] truncate`}>{row.title || '—'}</td>
                  <td className={TD}>
                    <div className="flex flex-wrap gap-1">
                      {[
                        ['few_photos', 'fewPhotos'], ['no_commune', 'noCommune'], ['no_quartier', 'noQuartier'],
                        ['short_description', 'shortDescription'], ['land_with_rooms', 'landWithRooms'], ['no_price', 'noPrice'],
                      ].filter(([column]) => row[column]).map(([column, key]) => (
                        <Chip key={column} tone="warning">{t(`admin.seoAudit.quality.${key}`)}</Chip>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Panel>

      <section className="u-card space-y-3 rounded-card bg-surface p-5">
        <h2 className="u-title-card text-ink">{t('admin.seoAudit.plan.title')}</h2>
        <p className="u-micro text-ink-45">{t('admin.seoAudit.plan.note')}</p>
        <ol className="space-y-3">
          {['1', '2', '3', '4', '5', '6', '7', '8'].map((n) => (
            <li key={n} className="flex gap-3">
              <span className="u-micro-strong flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue text-white">{n}</span>
              <div>
                <div className="u-micro-strong text-ink">{t(`admin.seoAudit.plan.step${n}.title`)}</div>
                <div className="u-micro text-ink-70">{t(`admin.seoAudit.plan.step${n}.body`)}</div>
              </div>
            </li>
          ))}
        </ol>
        <p className="u-micro text-ink-45">
          {t('admin.seoAudit.plan.speed')}{' '}
          <External href={`https://pagespeed.web.dev/analysis?url=${encodeURIComponent(`${SITE}/location/appartements`)}`}>PageSpeed Insights</External>
        </p>
      </section>
    </div>
  );
}
