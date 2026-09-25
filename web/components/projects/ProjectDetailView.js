import Link from 'next/link';
import { BadgeCheck, CalendarClock, Check, Info, LandPlot, MapPin, Ruler, ScrollText } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import ShareButton from '@/components/ShareButton';
import Price from '@/components/Price';
import JsonLd from '@/components/seo/JsonLd';
import ProjectGallery from '@/components/projects/ProjectGallery';
import UnitTypesTable from '@/components/projects/UnitTypesTable';
import PaymentPlan from '@/components/projects/PaymentPlan';
import ConstructionTimeline from '@/components/projects/ConstructionTimeline';
import PortionSelector from '@/components/projects/PortionSelector';
import LotPlan from '@/components/projects/LotPlan';
import ProjectEnquiryCard from '@/components/projects/ProjectEnquiryCard';
import ProjectsMapPane from '@/components/projects/ProjectsMapPane';
import { projectCover, projectPosition } from '@/lib/developments';
import {
  LOT_STATUS_LABEL_KEYS, TITLE_STATUS_LABEL_KEYS, normalisePaymentPlan, portionRows, salesProgress,
  pricePerM2, projectPinLabel, youtubeEmbedUrl,
} from '@/lib/developmentRules';
import {
  availabilityLine, deliveryLabel, fromPrice, projectKindLabel, projectLocationLine, shortDate, stageLabel,
} from '@/lib/projectView';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

function Fact({ icon: Icon, label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-start gap-2.5">
      <Icon strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-ink-45" />
      <div className="flex flex-col">
        <span className="text-[0.75rem] text-ink-45">{label}</span>
        <span className="text-sm font-semibold text-ink">{value}</span>
      </div>
    </div>
  );
}

/**
 * The body of a project page — shared by the public page (/projets/[slug])
 * and the developer's / team's preview (/projets/apercu/[id]). `preview`
 * swaps the enquiry form for a notice (a draft takes no enquiries) and drops
 * the structured data (a draft is not a page to describe to search engines).
 */
export default async function ProjectDetailView({ project, interest = '', sent = false, error = null, preview = false }) {
  const t = await getT();
  const where = projectLocationLine(project);
  const progress = salesProgress(project);
  const price = fromPrice(project);
  const availability = availabilityLine(project, t);
  const plan = normalisePaymentPlan(project.payment_plan);
  const planOptions = (project.unit_types || [])
    .filter((u) => u.purpose === 'sale' && (u.price_min ?? u.price_max) !== null)
    .map((u) => ({ id: `unit:${u.id}`, label: u.label, price: Number(u.price_min ?? u.price_max) }));
  const portions = project.kind === 'land' ? portionRows(project.lots, project.land_area_m2) : [];
  const plainLots = project.kind === 'land' ? (project.lots || []).filter((l) => l.share_percent === null) : [];
  const position = projectPosition(project);
  const embed = youtubeEmbedUrl(project.video_url);
  const label = projectPinLabel(project);
  const cover = projectCover(project);

  const pins = position ? [{
    id: project.id, slug: project.slug, name: project.name, verified: Boolean(project.verified_at),
    label: t(label.key, label.vars), subtitle: null, cover: cover?.src || null, coverIsRender: Boolean(cover?.isRender), ...position,
  }] : [];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': project.kind === 'land' ? 'Place' : 'ApartmentComplex',
    name: project.name,
    url: `https://lukkaplace.com/projets/${project.slug}`,
    ...(cover && !cover.isRender ? { image: cover.src } : {}),
    ...(where ? { address: { '@type': 'PostalAddress', addressLocality: project.commune || undefined, addressRegion: 'Kinshasa', addressCountry: 'CD' } } : {}),
  };

  return (
    <div className="pb-28 lg:pb-16">
      {preview ? null : <JsonLd data={jsonLd} />}
      {preview ? (
        <div className="bg-warning-tint px-4 py-2 text-center text-sm font-semibold text-ink" role="status">{t('projects.preview.banner')}</div>
      ) : null}
      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8">
        <div className="mb-4 hidden items-center justify-between gap-4 sm:flex">
          <Breadcrumb
            className="min-w-0"
            items={[
              { label: t('breadcrumb.home'), href: '/' },
              { label: t('projects.hub.crumb'), href: '/projets' },
              { label: project.name },
            ]}
          />
          <ShareButton title={project.name} />
        </div>

        <ProjectGallery project={project} />

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,68fr)_minmax(0,32fr)] lg:items-start">
          <div className="flex min-w-0 flex-col gap-8">
            <header className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-ink px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-white">
                  {projectKindLabel(project, t)}
                </span>
                {project.kind === 'building' && project.stage ? (
                  <span className="rounded-full bg-blue-tint px-2.5 py-1 text-[0.75rem] font-semibold text-blue-deep">{stageLabel(project, t)}</span>
                ) : null}
                {project.verified_at ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success-tint px-2.5 py-1 text-[0.75rem] font-semibold text-success">
                    <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                    {t('projects.badge.verified')}
                  </span>
                ) : null}
              </div>
              <h1 className="u-title-hero text-ink">{project.name}</h1>
              {where ? (
                <p className="inline-flex items-center gap-1.5 text-[0.9375rem] text-ink-70">
                  <MapPin strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" />
                  {[project.address, where].filter(Boolean).join(' · ')}
                </p>
              ) : null}
              {price ? (
                <p className="u-tabular text-[1.5rem] font-semibold text-ink">
                  <span className="mr-1.5 text-[0.9375rem] font-medium text-ink-45">{t('projects.card.from')}</span>
                  <Price amount={price.amount} purpose={price.purpose} pricePeriod={price.period} showSubtext />
                </p>
              ) : null}
            </header>

            {progress ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-semibold text-ink">{t('projects.progress.sold', { percent: progress.percent })}</span>
                  {progress.total ? <span className="text-ink-45">{t('projects.progress.units', { sold: progress.sold, total: progress.total })}</span> : null}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-canvas-alt" role="img" aria-label={t('projects.progress.sold', { percent: progress.percent })}>
                  <div className="h-full rounded-full bg-success" style={{ width: `${progress.percent}%` }} />
                </div>
              </div>
            ) : null}

            <section className="grid grid-cols-2 gap-4 rounded-card border border-line bg-surface p-5 sm:grid-cols-3">
              <Fact icon={CalendarClock} label={t('projects.facts.delivery')} value={project.kind === 'building' && project.stage !== 'delivered' ? deliveryLabel(project.delivery_expected, t.locale) : null} />
              <Fact icon={Check} label={t('projects.facts.availability')} value={availability} />
              <Fact icon={LandPlot} label={t('projects.facts.landArea')} value={project.land_area_m2 ? `${Number(project.land_area_m2).toLocaleString('fr-FR')} m²` : null} />
              <Fact icon={ScrollText} label={t('projects.facts.title')} value={project.land_title_status ? t(TITLE_STATUS_LABEL_KEYS[project.land_title_status]) : null} />
              <Fact icon={Ruler} label={t('projects.facts.types')} value={project.kind === 'building' && project.unit_types?.length ? t('projects.facts.typesCount', { count: project.unit_types.length }) : null} />
              <Fact icon={Info} label={t('projects.facts.developer')} value={project.agency_name || project.developer_name} />
            </section>

            <VerificationPanel project={project} t={t} />

            {project.kind === 'building' ? <UnitTypesTable project={project} /> : null}

            {project.kind === 'land' && portions.length ? (
              <section className="flex flex-col gap-3" id="portions">
                <h2 className="u-title-section text-ink">{t('projects.portions.title')}</h2>
                <p className="text-sm text-ink-70">{t('projects.portions.intro')}</p>
                <PortionSelector rows={portions} />
              </section>
            ) : null}

            {project.kind === 'land' && (project.lots || []).some((l) => Array.isArray(l.polygon)) && project.plan_image ? (
              <section className="flex flex-col gap-3" id="plan">
                <h2 className="u-title-section text-ink">{t('projects.lots.planTitle')}</h2>
                <LotPlan planImage={project.plan_image} lots={project.lots} projectName={project.name} />
              </section>
            ) : null}

            {plainLots.length ? (
              <section className="flex flex-col gap-3" id="lots">
                <h2 className="u-title-section text-ink">{t('projects.lots.listTitle')}</h2>
                <div className="overflow-x-auto rounded-card border border-line bg-surface">
                  <table className="w-full min-w-[32rem] text-sm">
                    <thead className="bg-canvas-alt text-left text-[0.75rem] text-ink-45">
                      <tr>
                        <th className="px-4 py-2 font-semibold">{t('projects.lots.lot')}</th>
                        <th className="px-4 py-2 text-right font-semibold">{t('projects.lots.area')}</th>
                        <th className="px-4 py-2 text-right font-semibold">{t('projects.lots.price')}</th>
                        <th className="px-4 py-2 text-right font-semibold">{t('projects.lots.perM2')}</th>
                        <th className="px-4 py-2 font-semibold">{t('projects.lots.status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plainLots.map((lot) => {
                        const perM2 = pricePerM2(lot.price, lot.area_m2);
                        return (
                          <tr key={lot.id} className="border-t border-line">
                            <td className="px-4 py-2.5 font-semibold text-ink">{lot.label}</td>
                            <td className="u-tabular px-4 py-2.5 text-right">{lot.area_m2 !== null ? `${Number(lot.area_m2).toLocaleString('fr-FR')} m²` : '—'}</td>
                            <td className="u-tabular px-4 py-2.5 text-right font-semibold">{lot.price !== null ? `${Number(lot.price).toLocaleString('fr-FR')} $` : '—'}</td>
                            <td className="u-tabular px-4 py-2.5 text-right text-ink-70">{perM2 !== null ? `${perM2.toLocaleString('fr-FR')} $` : '—'}</td>
                            <td className="px-4 py-2.5">
                              {lot.status === 'sold' ? (
                                <span className="text-danger">{t(LOT_STATUS_LABEL_KEYS.sold)}</span>
                              ) : (
                                <Link href={`?interest=lot:${lot.id}#contact`} className="font-semibold text-blue-deep hover:underline">
                                  {t(LOT_STATUS_LABEL_KEYS[lot.status])} · {t('projects.lots.ask')}
                                </Link>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {plan.complete ? <PaymentPlan plan={plan.rows} options={planOptions} /> : null}

            {project.kind === 'building' ? <ConstructionTimeline project={project} /> : null}

            {project.description ? (
              <section className="flex flex-col gap-3">
                <h2 className="u-title-section text-ink">{t('projects.description')}</h2>
                <div className="whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-70">{project.description}</div>
              </section>
            ) : null}

            {project.amenities?.length ? (
              <section className="flex flex-col gap-3">
                <h2 className="u-title-section text-ink">{t('projects.amenities')}</h2>
                <ul className="flex flex-wrap gap-2">
                  {project.amenities.map((item) => <li key={item} className="u-tag">{item}</li>)}
                </ul>
              </section>
            ) : null}

            {embed ? (
              <section className="flex flex-col gap-3">
                <h2 className="u-title-section text-ink">{t('projects.video')}</h2>
                <div className="relative aspect-video overflow-hidden rounded-card bg-ink">
                  <iframe
                    src={embed}
                    title={project.name}
                    loading="lazy"
                    allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="absolute inset-0 h-full w-full"
                  />
                </div>
              </section>
            ) : project.video_url ? (
              <a href={project.video_url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-blue-deep hover:underline">
                {t('projects.videoLink')}
              </a>
            ) : null}

            {pins.length ? (
              <section className="flex flex-col gap-3">
                <h2 className="u-title-section text-ink">{t('projects.location')}</h2>
                <ProjectsMapPane pins={pins} single />
              </section>
            ) : null}
          </div>

          <aside id="contact" className="scroll-mt-24 lg:sticky lg:top-24">
            {preview ? (
              <div className="rounded-card border border-line bg-surface p-5 text-sm text-ink-70">{t('projects.preview.enquiryOff')}</div>
            ) : (
              <ProjectEnquiryCard project={project} interest={interest} sent={sent} error={error} />
            )}
          </aside>
        </div>
      </div>

      {preview ? null : <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 lg:hidden">
        <a href="#contact" className="u-btn-primary flex min-h-11 items-center justify-center rounded-full bg-blue text-sm font-semibold text-white">
          {t('projects.enquiry.contactBar')}
        </a>
      </div>}
    </div>
  );
}

function VerificationPanel({ project, t }) {
  if (project.verified_at) {
    return (
      <section className="flex items-start gap-3 rounded-card border border-success/30 bg-success-tint p-4">
        <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-semibold text-ink">{t('projects.verification.verifiedTitle', { date: shortDate(project.verified_at, t.locale) })}</p>
          <p className="text-ink-70">{t('projects.verification.verifiedBody')}</p>
          {project.verification_note ? <p className="text-ink-70">{project.verification_note}</p> : null}
        </div>
      </section>
    );
  }
  return (
    <section className="flex items-start gap-3 rounded-card border border-line bg-surface p-4">
      <Info strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-5 w-5 shrink-0 text-ink-45" />
      <div className="flex flex-col gap-1 text-sm">
        <p className="font-semibold text-ink">{t('projects.verification.pendingTitle')}</p>
        <p className="text-ink-70">{t('projects.verification.pendingBody')}</p>
      </div>
    </section>
  );
}
