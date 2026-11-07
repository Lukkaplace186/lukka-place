import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Bell, CalendarClock, ChevronRight, Home, MapPin, Pencil } from 'lucide-react';
import ClientMiniListingCard from '@/components/ClientMiniListingCard';
import { getPortalCustomer } from '@/lib/customerPortal';
import { listSavedSearches } from '@/lib/customers';
import { getMoveProject } from '@/lib/moveProjects';
import { getMoveMatches } from '@/lib/moveMatches';
import { MOVE_RESEND_AFTER_MS, budgetRangeText, moveRequestBlocker, moveSearchQuery, moveStoryParts } from '@/lib/moveProjectRules';
import { firstName } from '@/lib/clientPortalView';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getLocale, getT } from '@/lib/i18n/server';
import SendMoveRequest from './SendMoveRequest';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('account.move.page.metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

const CARD = 'rounded-card bg-surface shadow-[var(--hairline),var(--shadow-card)]';
const RESULTS_LIMIT = 8;

function bedroomsLabel(n, t) {
  if (n === 1) return t('account.move.steps.bedrooms.one');
  return t('account.move.steps.bedrooms.many', { count: n >= 5 ? '5+' : n });
}

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
async function ResultsSection({ project, t }) {
  let result;
  try {
    result = await getMoveMatches(project, { exactLimit: RESULTS_LIMIT });
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
 * "Mon déménagement" (2026-11-07): the customer's move as they told it on
 * the cards, the homes that match it, its alert, and the one button that
 * sends it to agencies. `?nouveau=1` is the landing right after signup.
 */
export default async function MoveProjectPage({ searchParams }) {
  const params = await searchParams;
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client/projet');
  const { customerId, customer } = session;
  const t = await getT();
  const locale = await getLocale();
  const project = await getMoveProject(customerId);

  if (!project) {
    return (
      <div className="mx-auto flex max-w-[45rem] flex-col gap-4">
        <section className={`flex flex-col gap-3 p-5 ${CARD}`}>
          <p className="u-eyebrow text-blue">{t('account.move.eyebrow')}</p>
          <h1 className="u-title-section text-ink">{t('account.move.page.empty.title')}</h1>
          <p className="text-[0.9375rem] text-ink-45">{t('account.move.page.empty.lead')}</p>
          <Link href="/compte/client/projet/modifier" className="u-btn-primary inline-flex min-h-12 items-center justify-center rounded-md bg-blue px-4 text-[0.9375rem] font-bold text-white hover:bg-blue-deep">
            {t('account.move.page.empty.cta')}
          </Link>
        </section>
      </div>
    );
  }

  const story = moveStoryParts(project);
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

  const reasonLabels = [
    ...story.reasons.map((r) => t(`account.move.steps.reasons.options.${r}`)),
    ...(story.reasonOther ? [story.reasonOther] : []),
  ];
  const fromLine = story.from
    ? [t(`account.move.steps.current.options.${story.from.type}`), story.from.commune].filter(Boolean).join(', ')
    : null;
  const tx = project.transactionType === 'vente'
    ? t('account.move.steps.transaction.options.vente')
    : project.leaseTerm === 'short'
      ? t('account.move.steps.transaction.options.courte')
      : project.transactionType ? t('account.move.steps.transaction.options.location') : null;
  const toLine = [
    tx,
    project.bedroomsMin ? bedroomsLabel(project.bedroomsMin, t) : null,
    story.to?.communes?.length ? story.to.communes.join(', ') : null,
    budgetRangeText(project.budgetMin, project.budgetMax, {
      between: (min, max) => t('account.move.steps.budget.between', { min, max }),
      from: (amount) => t('account.move.steps.budget.from', { amount }),
      upTo: (amount) => t('account.move.steps.budget.upTo', { amount }),
    }),
  ].filter(Boolean).join(' · ');
  const whenLine = story.when ? t(`account.move.steps.timeline.options.${story.when}`) : null;
  const sentDate = project.lastLeadAt
    ? new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', timeZone: 'Africa/Kinshasa' }).format(new Date(project.lastLeadAt))
    : null;
  const name = firstName(customer.full_name);
  // Same window as sendMoveRequestAction's refusal: one push to agencies a day.
  const recentlySent = Boolean(project.lastLeadAt) && Date.now() - new Date(project.lastLeadAt).getTime() < MOVE_RESEND_AFTER_MS;

  return (
    <div className="mx-auto flex max-w-[45rem] flex-col gap-4 sm:gap-5">
      <div>
        {params?.nouveau === '1' && name ? (
          <p className="u-reveal mb-2 rounded-xl bg-green-tint px-4 py-3 text-[0.9375rem] font-semibold text-green-deep" role="status">
            {t('account.move.page.welcome', { name })}
          </p>
        ) : null}
        <h1 className="u-title-page text-ink">{t('account.move.page.title')}</h1>
      </div>

      <section className={`relative overflow-hidden p-4 sm:p-5 ${CARD}`} aria-labelledby="move-story">
        <div className="flex items-start justify-between gap-3">
          <h2 id="move-story" className="u-title-card text-ink">{t('account.move.page.storyTitle')}</h2>
          <Link href="/compte/client/projet/modifier" className="inline-flex min-h-11 items-center gap-1 text-[0.8125rem] font-bold text-blue hover:underline">
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
        {alertOn ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-blue-tint px-3 py-2.5 text-[0.8125rem] text-blue-deep">
            <Bell strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
            {t('account.move.page.alertOn')}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="move-results">
        <h2 id="move-results" className="u-title-card text-ink">{t('account.move.page.results.title')}</h2>
        {query ? (
          <Suspense fallback={<ResultsSkeleton />}>
            <ResultsSection project={project} t={t} />
          </Suspense>
        ) : (
          <p className="text-sm text-ink-45">{t('account.move.page.results.noQuery')}</p>
        )}
      </section>

      <section className={`flex flex-col gap-3 p-4 sm:p-5 ${CARD}`} aria-labelledby="move-request">
        <h2 id="move-request" className="u-title-card text-ink">{t('account.move.page.request.title')}</h2>
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
          <SendMoveRequest />
        )}
      </section>
    </div>
  );
}
