import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, BadgeCheck, ExternalLink, Trash2 } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import ProjectDetailsForm from '../ProjectDetailsForm';
import LotPlanEditor from '../LotPlanEditor';
import {
  addUpdateAction, deleteLotAction, deleteProjectAction, deleteUnitTypeAction, deleteUpdateAction,
  removeImageAction, saveLotAction, saveUnitTypeAction, setPublishedAction, setVerifiedAction,
  updateProjectAction, uploadImagesAction, uploadPlanAction,
} from '../actions';
import { getProjectForAdmin } from '@/lib/developments';
import { dayLabel } from '@/lib/projectView';
import {
  LOT_STATUSES, LOT_STATUS_LABEL_KEYS, TITLE_STATUSES, TITLE_STATUS_LABEL_KEYS, polygonToText, publishBlockers,
} from '@/lib/developmentRules';
import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('admin.projects.editTitle'), robots: { index: false, follow: false } };
}

const INPUT = 'min-h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink';

function Card({ id, title, children, intro = null }) {
  return (
    <section id={id} className="flex scroll-mt-24 flex-col gap-4 rounded-card border border-line bg-surface p-5 sm:p-6">
      <div>
        <h2 className="u-title-card text-ink">{title}</h2>
        {intro ? <p className="u-micro mt-1 text-ink-70">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Num({ name, label, value, step = 'any' }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.75rem] font-semibold text-ink-45">{label}</span>
      <input name={name} type="number" step={step} min="0" defaultValue={value ?? ''} className={INPUT} />
    </label>
  );
}

function UnitForm({ projectId, unit = null, t }) {
  const action = saveUnitTypeAction.bind(null, projectId, unit?.id ?? null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-4">
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-[0.75rem] font-semibold text-ink-45">{t('admin.projects.units.label')}</span>
        <input name="label" required maxLength={80} defaultValue={unit?.label || ''} placeholder={t('admin.projects.units.labelExample')} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] font-semibold text-ink-45">{t('admin.projects.units.purpose')}</span>
        <select name="purpose" defaultValue={unit?.purpose || 'sale'} className={INPUT}>
          <option value="sale">{t('admin.projects.purposes.sale')}</option>
          <option value="rent">{t('admin.projects.purposes.rent')}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] font-semibold text-ink-45">{t('admin.projects.units.period')}</span>
        <select name="price_period" defaultValue={unit?.price_period || 'month'} className={INPUT}>
          <option value="month">{t('admin.projects.units.month')}</option>
          <option value="year">{t('admin.projects.units.year')}</option>
        </select>
      </label>
      <Num name="bedrooms" label={t('admin.projects.units.bedrooms')} value={unit?.bedrooms} step="1" />
      <Num name="bathrooms" label={t('admin.projects.units.bathrooms')} value={unit?.bathrooms} step="1" />
      <Num name="area_m2" label={t('admin.projects.units.area')} value={unit?.area_m2} />
      <Num name="sort_order" label={t('admin.projects.units.order')} value={unit?.sort_order ?? 0} step="1" />
      <Num name="price_min" label={t('admin.projects.units.priceMin')} value={unit?.price_min} />
      <Num name="price_max" label={t('admin.projects.units.priceMax')} value={unit?.price_max} />
      <Num name="units_total" label={t('admin.projects.units.total')} value={unit?.units_total} step="1" />
      <Num name="units_available" label={t('admin.projects.units.available')} value={unit?.units_available} step="1" />
      <div className="flex items-end gap-2 sm:col-span-4">
        <button type="submit" className="u-btn-primary inline-flex min-h-10 items-center rounded-full bg-blue px-4 text-sm font-semibold text-white">
          {unit ? t('admin.projects.save') : t('admin.projects.units.add')}
        </button>
      </div>
    </form>
  );
}

function LotForm({ project, lot = null, t }) {
  const action = saveLotAction.bind(null, project.id, lot?.id ?? null);
  const others = (project.lots || []).filter((l) => l.id !== lot?.id && Array.isArray(l.polygon)).map((l) => l.polygon);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-4">
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] font-semibold text-ink-45">{t('admin.projects.lots.label')}</span>
        <input name="label" required maxLength={60} defaultValue={lot?.label || ''} placeholder="Lot 1" className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] font-semibold text-ink-45">{t('admin.projects.lots.status')}</span>
        <select name="status" defaultValue={lot?.status || 'available'} className={INPUT}>
          {LOT_STATUSES.map((s) => <option key={s} value={s}>{t(LOT_STATUS_LABEL_KEYS[s])}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] font-semibold text-ink-45">{t('admin.projects.lots.title')}</span>
        <select name="title_status" defaultValue={lot?.title_status || ''} className={INPUT}>
          <option value="">—</option>
          {TITLE_STATUSES.map((s) => <option key={s} value={s}>{t(TITLE_STATUS_LABEL_KEYS[s])}</option>)}
        </select>
      </label>
      <Num name="sort_order" label={t('admin.projects.units.order')} value={lot?.sort_order ?? 0} step="1" />
      <Num name="area_m2" label={t('admin.projects.lots.area')} value={lot?.area_m2} />
      <Num name="price" label={t('admin.projects.lots.price')} value={lot?.price} />
      <Num name="share_percent" label={t('admin.projects.lots.share')} value={lot?.share_percent} />
      <div className="sm:col-span-4">
        <LotPlanEditor planImage={project.plan_image} initial={lot?.polygon || null} others={others} />
      </div>
      <div className="sm:col-span-4">
        <button type="submit" className="u-btn-primary inline-flex min-h-10 items-center rounded-full bg-blue px-4 text-sm font-semibold text-white">
          {lot ? t('admin.projects.save') : t('admin.projects.lots.add')}
        </button>
      </div>
    </form>
  );
}

function ImageStrip({ project, field, t }) {
  const urls = project[field] || [];
  return (
    <div className="flex flex-col gap-3">
      {urls.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {urls.map((url) => (
            <li key={url} className="flex flex-col gap-1">
              <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-canvas-alt">
                <SafeImage src={url} alt="" fill sizes="200px" className="object-cover" />
              </div>
              <form action={removeImageAction.bind(null, project.id, field, url)}>
                <button type="submit" className="text-[0.75rem] font-semibold text-danger hover:underline">{t('admin.projects.media.remove')}</button>
              </form>
            </li>
          ))}
        </ul>
      ) : <p className="u-micro text-ink-45">{t('admin.projects.media.none')}</p>}
      <form action={uploadImagesAction.bind(null, project.id, field)} className="flex flex-wrap items-center gap-3">
        <input type="file" name="images" accept="image/jpeg,image/png,image/webp" multiple required className="text-sm" />
        <button type="submit" className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-ink-25">
          {t('admin.projects.media.upload')}
        </button>
      </form>
    </div>
  );
}

/**
 * One project, every part of it on one page: facts, media, unit types (a
 * building) or lots + plan (land), construction timeline, then publish /
 * verify / delete. Each card is its own form so a save never loses another
 * card's unsaved edits.
 */
export default async function AdminProjectPage({ params, searchParams }) {
  const t = await getT();
  const { id } = await params;
  const sp = await searchParams;
  const project = await getProjectForAdmin(id);
  if (!project) notFound();
  const session = await getAdminSession();
  const canManage = can(session?.role, 'projects.manage');

  const errorKey = typeof sp.error === 'string' ? `admin.projects.errors.${sp.error}` : null;
  const savedKey = typeof sp.saved === 'string' ? `admin.projects.saved.${sp.saved}` : null;
  const published = project.status === 1 && project.approve_status === 1;
  const blockers = publishBlockers(project);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link href="/admin/projets" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-70 hover:text-ink">
        <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        {t('admin.projects.back')}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="u-title-page text-ink">{project.name}</h1>
          <p className="u-micro mt-1 text-ink-70">
            {published ? t('admin.projects.status.published') : t('admin.projects.status.draft')}
            {project.verified_at ? ` · ${t('projects.badge.verified')}` : ''}
          </p>
        </div>
        {published ? (
          <Link href={`/projets/${project.slug}`} target="_blank" className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-deep hover:underline">
            {t('admin.projects.viewPublic')}
            <ExternalLink strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          </Link>
        ) : null}
      </div>

      {errorKey ? (
        <p className="rounded-lg bg-danger-tint px-4 py-2 text-sm font-semibold text-danger" role="alert">
          {t.has(errorKey) ? t(errorKey) : t('admin.projects.errors.generic')}
        </p>
      ) : null}
      {savedKey && t.has(savedKey) ? <p className="rounded-lg bg-success-tint px-4 py-2 text-sm text-success" role="status">{t(savedKey)}</p> : null}
      {!canManage ? <p className="rounded-lg bg-warning-tint px-4 py-2 text-sm text-ink">{t('admin.projects.readOnly')}</p> : null}

      <Card id="publication" title={t('admin.projects.publishTitle')} intro={t('admin.projects.publishIntro')}>
        {blockers.length && !published ? (
          <ul className="list-disc pl-5 text-sm text-ink-70">
            {blockers.map((b) => <li key={b}>{t(`admin.projects.errors.publish_${b}`)}</li>)}
          </ul>
        ) : null}
        <form action={setPublishedAction.bind(null, project.id, !published)}>
          <button
            type="submit"
            disabled={!published && blockers.length > 0}
            className={published
              ? 'rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-ink-25'
              : 'u-btn-primary rounded-full bg-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-40'}
          >
            {published ? t('admin.projects.unpublish') : t('admin.projects.publish')}
          </button>
        </form>
      </Card>

      <Card id="verification" title={t('admin.projects.verifyTitle')} intro={t('admin.projects.verifyIntro')}>
        {project.verified_at ? (
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-sm text-success">
              <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('admin.projects.verifiedBy', { who: project.verified_by || '—', date: new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(project.verified_at)) })}
            </p>
            {project.verification_note ? <p className="text-sm text-ink-70">{project.verification_note}</p> : null}
            <form action={setVerifiedAction.bind(null, project.id)}>
              <input type="hidden" name="verified" value="0" />
              <button type="submit" className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink">{t('admin.projects.unverify')}</button>
            </form>
          </div>
        ) : (
          <form action={setVerifiedAction.bind(null, project.id)} className="flex flex-col gap-3">
            <input type="hidden" name="verified" value="1" />
            <textarea name="note" rows={2} minLength={10} maxLength={500} required placeholder={t('admin.projects.verifyNotePlaceholder')} className="rounded-lg border border-line px-3 py-2 text-sm" />
            <button type="submit" className="self-start rounded-full bg-success px-4 py-2 text-sm font-semibold text-white">{t('admin.projects.verify')}</button>
          </form>
        )}
      </Card>

      <Card id="details" title={t('admin.projects.detailsTitle')}>
        <ProjectDetailsForm action={updateProjectAction.bind(null, project.id)} project={project} submitLabel={t('admin.projects.save')} />
      </Card>

      <Card id="photos" title={t('admin.projects.media.photosTitle')} intro={t('admin.projects.media.photosIntro')}>
        <ImageStrip project={project} field="photos" t={t} />
      </Card>

      <Card id="renders" title={t('admin.projects.media.rendersTitle')} intro={t('admin.projects.media.rendersIntro')}>
        <ImageStrip project={project} field="renders" t={t} />
      </Card>

      {project.kind === 'building' ? (
        <Card id="types" title={t('admin.projects.units.title')} intro={t('admin.projects.units.intro')}>
          {(project.unit_types || []).map((unit) => (
            <div key={unit.id} className="flex flex-col gap-2 border-b border-line pb-4">
              <UnitForm projectId={project.id} unit={unit} t={t} />
              <form action={deleteUnitTypeAction.bind(null, project.id, unit.id)}>
                <button type="submit" className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-danger hover:underline">
                  <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />{t('admin.projects.delete')}
                </button>
              </form>
            </div>
          ))}
          <p className="u-micro-strong text-ink">{t('admin.projects.units.new')}</p>
          <UnitForm projectId={project.id} t={t} />
        </Card>
      ) : null}

      {project.kind === 'land' ? (
        <>
          <Card id="plan" title={t('admin.projects.lots.planTitle')} intro={t('admin.projects.lots.planIntro')}>
            {project.plan_image ? (
              <div className="relative max-w-md overflow-hidden rounded-lg border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of the stored plan */}
                <img src={project.plan_image} alt="" className="block h-auto w-full" />
              </div>
            ) : null}
            <form action={uploadPlanAction.bind(null, project.id)} className="flex flex-wrap items-center gap-3">
              <input type="file" name="plan" accept="image/jpeg,image/png,image/webp" required className="text-sm" />
              <button type="submit" className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink">
                {project.plan_image ? t('admin.projects.lots.replacePlan') : t('admin.projects.lots.uploadPlan')}
              </button>
            </form>
          </Card>

          <Card id="lots" title={t('admin.projects.lots.title')} intro={t('admin.projects.lots.intro')}>
            {(project.lots || []).map((lot) => (
              <details key={lot.id} className="rounded-lg border border-line p-3">
                <summary className="cursor-pointer text-sm font-semibold text-ink">
                  {lot.label} · {t(LOT_STATUS_LABEL_KEYS[lot.status])}
                  {lot.share_percent !== null ? ` · ${Number(lot.share_percent)}%` : ''}
                  {lot.price !== null ? ` · ${Number(lot.price).toLocaleString('fr-FR')} $` : ''}
                  {Array.isArray(lot.polygon) ? ` · ${t('admin.projects.lots.traced')}` : ''}
                </summary>
                <div className="mt-3 flex flex-col gap-2">
                  <LotForm project={project} lot={lot} t={t} />
                  <form action={deleteLotAction.bind(null, project.id, lot.id)}>
                    <button type="submit" className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-danger hover:underline">
                      <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />{t('admin.projects.delete')}
                    </button>
                  </form>
                </div>
              </details>
            ))}
            <p className="u-micro-strong text-ink">{t('admin.projects.lots.new')}</p>
            <LotForm project={project} t={t} />
          </Card>
        </>
      ) : null}

      <Card id="chantier" title={t('admin.projects.timeline.title')} intro={t('admin.projects.timeline.intro')}>
        {(project.updates || []).length ? (
          <ul className="flex flex-col gap-3">
            {project.updates.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3 text-sm">
                <span>
                  <span className="font-semibold text-ink">{dayLabel(u.taken_on, 'fr')}</span>
                  {u.caption ? ` — ${u.caption}` : ''}
                  <span className="text-ink-45"> · {t('admin.projects.timeline.photos', { count: (u.photos || []).length })}</span>
                </span>
                <form action={deleteUpdateAction.bind(null, project.id, u.id)}>
                  <button type="submit" className="text-[0.75rem] font-semibold text-danger hover:underline">{t('admin.projects.delete')}</button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
        <form action={addUpdateAction.bind(null, project.id)} className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <label className="flex flex-col gap-1">
            <span className="text-[0.75rem] font-semibold text-ink-45">{t('admin.projects.timeline.date')}</span>
            <input type="date" name="taken_on" required className={INPUT} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[0.75rem] font-semibold text-ink-45">{t('admin.projects.timeline.caption')}</span>
            <input name="caption" maxLength={500} placeholder={t('admin.projects.timeline.captionExample')} className={INPUT} />
          </label>
          <input type="file" name="images" accept="image/jpeg,image/png,image/webp" multiple className="text-sm sm:col-span-2" />
          <button type="submit" className="u-btn-primary self-start rounded-full bg-blue px-4 py-2 text-sm font-semibold text-white sm:col-span-2 sm:justify-self-start">
            {t('admin.projects.timeline.add')}
          </button>
        </form>
      </Card>

      <Card id="danger" title={t('admin.projects.deleteTitle')} intro={t('admin.projects.deleteIntro', { id: project.id })}>
        <form action={deleteProjectAction.bind(null, project.id)} className="flex flex-wrap items-center gap-3">
          <input name="confirm" required placeholder={String(project.id)} aria-label={t('admin.projects.deleteConfirmLabel')} className={`${INPUT} w-28`} />
          <button type="submit" className="rounded-full bg-danger px-4 py-2 text-sm font-semibold text-white">{t('admin.projects.deleteProject')}</button>
        </form>
      </Card>
    </div>
  );
}
