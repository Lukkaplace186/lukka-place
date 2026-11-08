import { Suspense } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Bell, CalendarClock, ChevronRight, Home, MapPin, Pencil } from 'lucide-react';
import ClientMiniListingCard from '@/components/ClientMiniListingCard';
import { getPortalCustomer } from '@/lib/customerPortal';
import { listSavedSearches } from '@/lib/customers';
import { listMoveProjects } from '@/lib/moveProjects';
import { getMoveMatches } from '@/lib/moveMatches';
import { MOVE_RESEND_AFTER_MS, checkinDue, moveRequestBlocker, moveSearchQuery, moveStageView } from '@/lib/moveProjectRules';
import { firstName } from '@/lib/clientPortalView';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getLocale, getT } from '@/lib/i18n/server';
import SendMoveRequest from '../SendMoveRequest';
import DeleteMoveProject from '../DeleteMoveProject';
import { storyLines } from '../storyLines';
import { deleteMoveProjectAction, setManualStageAction, markProjectFoundAction, pauseProjectAction, resumeProjectAction, sendMoveRequestAction, settleCheckinAction } from '../actions';
import ProjectStatusActions from '../ProjectStatusActions';
import { CheckinCard } from '../ProjectJourney';
import ProjectStepper from '../ProjectStepper';
import StageCard from '../StageCard';
import { getCustomerInquiries } from '@/lib/customerInquiries';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('account.move.page.metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

const CARD = 'rounded-card bg-surface shadow-[var(--hairline),var(--shadow-card)]';
const RESULTS_LIMIT = 8;


function closeTagText(tag, t) {
  if (tag.kind === 'above') return t('account.move.matches.tags.above', { pct: tag.pct });
  if (tag.kind === 'below') return t('account.move.matches.tags.below', { pct: tag.pct });
  return t('account.move.matches.tags.nearby', { commune: tag.commune, km: tag.km });
}

const RAIL = '-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0';

/**
 * The homes the project finds (lib/moveMatches.js): exact matches, newest
 * first; then, when few match, the closest ones apart, each saying why it is
 * close (a little over/under the budget, or a nearby commune).
 */
async function ResultsSection({ project, t, closeMode = 'auto' }) {
  let result;
  try {
    result = await getMoveMatches(project, { exactLimit: RESULTS_LIMIT, closeMode });
  } catch (err) {
    console.error(`[move-project] results failed: ${err.message}`);
    return <p className="text-sm text-ink-70">{t('account.move.page.results.error')}</p>;
  }
  if (!result) return null;
  const { query, total, exact, close } = result;
  return (
    <div className="flex flex-col gap-2">
      {exact.length ? (
        <>
          <p className="text-[0.8125rem] text-ink-45">{t('account.move.page.results.count', { count: total })}</p>
          <div className={RAIL}>
            {exact.map((listing) => (
              <ClientMiniListingCard key={listing.id} listing={listing} t={t} />
            ))}
          </div>
          <Link href={`/listings?${query}`} className="inline-flex min-h-11 items-center gap-0.5 self-start text-sm font-bold text-blue hover:underline">
            {t('account.move.page.results.seeAll')}
            <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
          </Link>
        </>
      ) : (
        <p className={`p-4 text-[0.9375rem] font-semibold text-ink ${CARD}`}>{t('account.move.page.results.none')}</p>
      )}
      {/* "Voir aussi" (owner, 2026-11-07): homes close by price or by place,
          on request, even when homes match exactly. Tap again to go back. */}
      {project.budgetMin || project.budgetMax || project.communes?.length ? (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-45">{t('account.move.matches.seeAlso')}</span>
          {[['price', 'prix', project.budgetMin || project.budgetMax, 'closePrice'], ['place', 'lieu', project.communes?.length, 'closePlace']]
            .filter(([, , ok]) => ok)
            .map(([mode, param, , labelKey]) => (
              <Link
                key={mode}
                href={closeMode === mode ? `/compte/client/projet/${project.id}#move-results` : `/compte/client/projet/${project.id}?proches=${param}#move-results`}
                aria-pressed={closeMode === mode}
                className={`inline-flex min-h-11 items-center rounded-full border px-3.5 text-[0.875rem] font-semibold ${closeMode === mode ? 'border-blue bg-blue text-white' : 'border-line bg-surface text-ink hover:border-blue'}`}
              >
                {t(`account.move.matches.${labelKey}`)}
              </Link>
            ))}
        </div>
      ) : null}
      {closeMode !== 'auto' && !close.length ? <p className="text-[0.8125rem] text-ink-45">{t('account.move.matches.noneClose')}</p> : null}
      {close.length ? (
        <section className="mt-2 flex flex-col gap-2" aria-labelledby="move-close">
          <h3 id="move-close" className="u-title-sub text-ink">{t('account.move.matches.closeTitle')}</h3>
          <div className={RAIL}>
            {close.map(({ listing, tags }) => (
              <div key={listing.id} className="flex flex-none snap-start flex-col gap-1.5">
                <ClientMiniListingCard listing={listing} t={t} />
                <div className="flex w-[15.625rem] flex-wrap gap-1">
                  {tags.map((tag) => (
                    <span key={`${tag.kind}-${tag.pct ?? tag.commune}`} className="rounded-full bg-amber-50 px-2 py-0.5 text-[0.75rem] font-bold text-amber-800">
                      {closeTagText(tag, t)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="flex gap-2.5 overflow-hidden">
      {[0, 1].map((i) => <div key={i} className="h-56 w-[15.625rem] flex-none animate-pulse rounded-card bg-canvas-deep" />)}
    </div>
  );
}

/**
 * One "Mon déménagement" project (2026-11-07; up to five per account): the
 * move as the customer told it, edit and delete, the homes that match it
 * (exact, then close), its alert, and the one button that sends it to
 * agencies. `?nouveau=1` is the landing right after signup or creation.
 * Another customer's id is a 404, like a missing one.
 */
export default async function MoveProjectPage({ params: routeParams, searchParams }) {
  const [{ id }, params] = await Promise.all([routeParams, searchParams]);
  const session = await getPortalCustomer();
  if (!session) redirect(`/compte/connexion?next=/compte/client/projet/${encodeURIComponent(id)}`);
  const { customerId, customer } = session;
  const t = await getT();
  const locale = await getLocale();
  const projects = await listMoveProjects(customerId);
  const index = projects.findIndex((p) => String(p.id) === String(id));
  const project = index >= 0 ? projects[index] : null;
  if (!project) notFound();

  const query = moveSearchQuery(project);
  const blocker = moveRequestBlocker(project);
  let alertOn = false;
  if (query) {
    try {
      alertOn = (await listSavedSearches(customerId)).some((s) => s.query === query);
    } catch {
      alertOn = false;
    }
  }

  const { name: projectName, reasonLabels, fromLine, toLine, whenLine } = storyLines(project, t, index);
  const sentDate = project.lastLeadAt
    ? new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', timeZone: 'Africa/Kinshasa' }).format(new Date(project.lastLeadAt))
    : null;
  const name = firstName(customer.full_name);
  // Same window as sendMoveRequestAction's refusal: one push to agencies a day.
  const recentlySent = Boolean(project.lastLeadAt) && Date.now() - new Date(project.lastLeadAt).getTime() < MOVE_RESEND_AFTER_MS;
  const active = project.status === 'active';
  // Every action of the customer since this project began feeds its stages
  // (owner, 2026-11-07): any request they sent (here, "Trouver pour moi", a
  // listing enquiry, a visit request) and any visit — and moveStagesReached
  // cascades, so a confirmed visit ticks "Demande envoyée" and "Recherche"
  // even when those were never tracked.
  let hasVisit = false;
  let hasRequest = false;
  let inquiries = [];
  const since = new Date(project.createdAt).getTime();
  try {
    const at = (value) => {
      if (!value) return 0;
      const text = String(value);
      const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(text) || text.includes('T') ? text : `${text.replace(' ', 'T')}Z`;
      return new Date(iso).getTime() || 0;
    };
    inquiries = await getCustomerInquiries(customerId);
    for (const { lead, viewings = [] } of inquiries) {
      if (lead && at(lead.created_at) >= since) hasRequest = true;
      if (viewings.some((v) => at(v.created_at) >= since)) hasVisit = true;
    }
  } catch {
    hasVisit = false;
  }
  // The customer's own stage wins, both ways; events are proof and hints.
  const stageView = moveStageView(project, { hasVisit, hasRequest });
  const foundDate = project.foundAt
    ? new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', timeZone: 'Africa/Kinshasa' }).format(new Date(project.foundAt))
    : null;

  return (
    <div className="mx-auto flex max-w-[45rem] flex-col gap-4 sm:gap-5">
      <div>
        {params?.nouveau === '1' && name ? (
          <p className="u-reveal mb-2 rounded-xl bg-green-tint px-4 py-3 text-[0.9375rem] font-semibold text-green-deep" role="status">
            {t('account.move.page.welcome', { name })}
          </p>
        ) : null}
        <Link href="/compte/client/projet" className="u-micro-strong mb-1 inline-flex min-h-11 items-center gap-1.5 text-ink-45 hover:text-ink">
          <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
          {t('account.move.list.back')}
        </Link>
        <p className="u-eyebrow text-blue">{t('account.move.eyebrow')}</p>
        <h1 className="u-title-page mt-1 text-ink">{projectName}</h1>
      </div>

      <ProjectStepper view={stageView} projectId={project.id} status={project.status} stageAction={setManualStageAction.bind(null, project.id)} />

      {params?.trouve === '1' || project.status === 'found' ? (
        <p className="rounded-xl bg-green-tint px-4 py-3 text-[0.9375rem] font-semibold text-green-deep" role="status">
          {foundDate ? t('account.move.status.foundBanner', { date: foundDate }) : t('account.move.status.foundBannerNow')}
        </p>
      ) : null}
      {project.status === 'paused' ? (
        <p className="rounded-xl bg-canvas-deep px-4 py-3 text-[0.9375rem] text-ink-70" role="status">{t('account.move.status.pausedBanner')}</p>
      ) : null}
      {params?.merci === '1' ? (
        <p className="rounded-xl bg-green-tint px-4 py-3 text-[0.9375rem] font-semibold text-green-deep" role="status">{t('account.move.checkin.thanks')}</p>
      ) : null}
      {params?.error === 'status' ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{t('account.move.status.error')}</p>
      ) : null}
      {checkinDue(project) || (params?.installe === '1' && project.status === 'found' && !project.settledAt) ? <CheckinCard action={settleCheckinAction.bind(null, project.id)} t={t} /> : null}

      {/* What matters at the current stage (owner, 2026-11-07). */}
      <StageCard stage={stageView.current} project={project} inquiries={inquiries} since={since} t={t} locale={locale} />


      <section className={`relative overflow-hidden p-4 sm:p-5 ${CARD}`} aria-labelledby="move-story">
        <div className="flex items-start justify-between gap-3">
          <h2 id="move-story" className="u-title-card text-ink">{t('account.move.page.storyTitle')}</h2>
          <Link href={`/compte/client/projet/${project.id}/modifier`} className="inline-flex min-h-11 items-center gap-1 text-[0.8125rem] font-bold text-blue hover:underline">
            <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
            {t('account.move.page.edit')}
          </Link>
        </div>
        {reasonLabels.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {reasonLabels.map((label) => (
              <li key={label} className="rounded-full bg-blue-tint px-3 py-1 text-[0.8125rem] font-bold text-blue-deep">{label}</li>
            ))}
          </ul>
        ) : null}
        <ul className="mt-3 flex flex-col gap-2 text-[0.9375rem] text-ink">
          {fromLine ? (
            <li className="flex items-start gap-2">
              <Home strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 flex-none text-ink-45" aria-hidden="true" />
              {t('account.move.page.from', { place: fromLine })}
            </li>
          ) : null}
          {toLine ? (
            <li className="flex items-start gap-2">
              <MapPin strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 flex-none text-blue" aria-hidden="true" />
              {t('account.move.page.to', { what: toLine })}
            </li>
          ) : null}
          {whenLine ? (
            <li className="flex items-start gap-2">
              <CalendarClock strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 flex-none text-ink-45" aria-hidden="true" />
              {t('account.move.page.when', { when: whenLine })}
            </li>
          ) : null}
        </ul>
        {alertOn && active ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-blue-tint px-3 py-2.5 text-[0.8125rem] text-blue-deep">
            <Bell strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
            {t('account.move.page.alertOn')}
          </p>
        ) : null}
      </section>

      {active ? (
      <>
      <section className="flex flex-col gap-2" aria-labelledby="move-results">
        <h2 id="move-results" className="u-title-card text-ink">{t('account.move.page.results.title')}</h2>
        {query ? (
          <Suspense fallback={<ResultsSkeleton />}>
            <ResultsSection project={project} t={t} closeMode={{ prix: 'price', lieu: 'place' }[params?.proches] || 'auto'} />
          </Suspense>
        ) : (
          <p className="text-sm text-ink-45">{t('account.move.page.results.noQuery')}</p>
        )}
      </section>

      <section className={`flex flex-col gap-3 p-4 sm:p-5 ${CARD}`} aria-labelledby="move-request">
        <h2 id="move-request" className="u-title-card scroll-mt-24 text-ink">{t('account.move.page.request.title')}</h2>
        <p className="text-[0.9375rem] text-ink-45">{t('account.move.page.request.lead')}</p>
        {blocker ? (
          <p className="rounded-xl bg-canvas-deep px-4 py-3 text-sm text-ink-70">{t(`account.move.page.request.missing.${blocker}`)}</p>
        ) : sentDate && recentlySent ? (
          <div className="flex flex-col gap-1">
            <p className="rounded-xl bg-green-tint px-4 py-3 text-[0.9375rem] font-semibold text-green-deep">{t('account.move.page.request.sent', { date: sentDate })}</p>
            <Link href="/compte/client/messages" className="inline-flex min-h-11 items-center text-sm font-bold text-blue hover:underline">
              {t('account.move.page.request.seeMessages')}
            </Link>
          </div>
        ) : (
          <SendMoveRequest action={sendMoveRequestAction.bind(null, project.id)} />
        )}
        <p className="text-[0.8125rem] text-ink-45">{t('account.move.page.request.followUp')}</p>
      </section>
      </>
      ) : null}


      <div id="statut" className="scroll-mt-24">
      <ProjectStatusActions
        status={project.status}
        askFound={params?.confirmer === 'trouve'}
        foundAction={markProjectFoundAction.bind(null, project.id)}
        pauseAction={pauseProjectAction.bind(null, project.id)}
        resumeAction={resumeProjectAction.bind(null, project.id)}
      />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/compte/client/projet/${project.id}/modifier`}
          className="u-press inline-flex min-h-11 items-center gap-1.5 rounded-md border border-line bg-surface px-4 text-sm font-bold text-ink hover:border-blue"
        >
          <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
          {t('account.move.page.edit')}
        </Link>
        <DeleteMoveProject action={deleteMoveProjectAction.bind(null, project.id)} />
      </div>
    </div>
  );
}
