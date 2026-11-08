import { Suspense } from 'react';
import NewSinceLastVisit from '@/components/NewSinceLastVisit';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Bell, ChevronRight, Heart, Map as MapIcon, Pencil, Plus, Search, ShieldCheck, Target, Truck } from 'lucide-react';
import { listMoveProjects } from '@/lib/moveProjects';
import { MAX_MOVE_PROJECTS, checkinDue, projectDisplayName } from '@/lib/moveProjectRules';
import ClientMiniListingCard from '@/components/ClientMiniListingCard';
import { getPortalCustomer, getPortalCounts } from '@/lib/customerPortal';
import { getCustomerInquiries } from '@/lib/customerInquiries';
import { listSavedSearches } from '@/lib/customers';
import { getSavedSearchMatches } from '@/lib/alerts';
import { groupCustomerVisits } from '@/lib/customerAgenda';
import { firstName, freshAlertListings, homeVisitInbox, proposedSlotAt, requestRows } from '@/lib/clientPortalView';
import { formatVisitDay, formatVisitTime } from '@/lib/visitAgenda';
import { formatPhoneDisplay } from '@/lib/phone';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getLocale, getT } from '@/lib/i18n/server';
import { moveRequestHref } from '@/lib/moveRequestHref';
import VisitCard from './visites/VisitCard';
import CustomerVisitActions from './visites/CustomerVisitActions';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('account.home.metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

const CARD = 'rounded-card bg-surface shadow-[var(--hairline),var(--shadow-card)]';

function SectionHead({ title, href, linkLabel }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="u-title-card text-ink">{title}</h2>
      {href ? (
        <Link href={href} className="inline-flex min-h-11 items-center gap-0.5 text-[0.8125rem] font-bold text-blue hover:underline">
          {linkLabel}
          <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

/** Skeletons the height of what they stand for, so nothing jumps. */
function Block({ className }) {
  return <div className={`animate-pulse rounded-card bg-canvas-deep ${className}`} />;
}

/**
 * What waits on the customer: a slot the agent proposed (royal card, one-tap
 * Accept), the three counters, the next confirmed visit, visits to rate.
 * Everything here comes from getCustomerInquiries (memoised per request, so
 * RequestsSection below reuses the same read).
 */
async function InboxSection({ customerId, counts }) {
  const t = await getT();
  const locale = await getLocale();
  const now = new Date();
  const inquiries = await getCustomerInquiries(customerId);
  const { answer, checkin, next } = homeVisitInbox(groupCustomerVisits(inquiries, now), now);
  const proposals = inquiries.reduce((n, { proposals: p = [] }) => n + p.length, 0);
  const first = answer[0];
  // The proposal in the reader's language when the agent's phrase parses,
  // their own words otherwise.
  const proposedAt = first ? proposedSlotAt(first.requestedTime, now) : null;
  const proposedLabel = proposedAt
    ? `${formatVisitDay(proposedAt, locale)} · ${formatVisitTime(proposedAt, locale)}`
    : first?.requestedTime || null;

  const stats = [
    { href: '/compte/client/favoris', value: counts.favorites, label: t('account.home.stats.favorites') },
    { href: '/compte/client/favoris?tab=alertes', value: counts.alerts, label: t('account.home.stats.alerts') },
    { href: '/compte/client/messages', value: proposals, label: t('account.home.stats.proposals') },
  ];

  return (
    <>
      {first ? (
        <section className="relative overflow-hidden rounded-[1.125rem] bg-blue-deep p-4 text-white sm:p-5" aria-labelledby="home-answer">
          <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-[radial-gradient(closest-side,rgba(185,198,251,.28),rgba(185,198,251,0))]" />
          <p className="u-eyebrow relative text-[#b9c6fb]">{t('account.home.answerEyebrow')}</p>
          <h2 id="home-answer" className="u-title-section relative mt-1.5 text-white">
            {proposedLabel ? t('account.home.answerTitle', { slot: proposedLabel }) : t('account.home.answerTitleNoSlot')}
          </h2>
          {first.listing ? <p className="relative mt-1.5 truncate text-[0.84375rem] text-[#dce3ff]">{first.listing.title}</p> : null}
          <div className="relative mt-3.5 grid grid-cols-2 gap-2.5">
            <CustomerVisitActions viewingId={first.id} status={first.status} variant="royal" />
            <Link
              href="/compte/client/visites"
              className="u-press inline-flex min-h-11 items-center justify-center rounded-[0.625rem] px-4 text-sm font-bold text-white shadow-[inset_0_0_0_1.5px_rgba(255,255,255,.6)]"
            >
              {answer.length > 1 ? t('account.home.answerMore', { count: answer.length - 1 }) : t('account.home.answerOptions')}
            </Link>
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-3 gap-2.5">
        {stats.map((s) => (
          <Link key={s.href} href={s.href} className={`u-press flex min-h-[4.75rem] flex-col p-3 ${CARD}`}>
            <span className="u-tabular text-2xl font-extrabold tracking-tight text-ink">{s.value}</span>
            <span className="text-[0.75rem] font-semibold text-ink-45">{s.label}</span>
          </Link>
        ))}
      </div>

      {checkin.length ? (
        <section className="flex flex-col gap-2">
          <SectionHead title={t('account.home.checkinTitle')} />
          {checkin.map((visit) => (
            <VisitCard key={visit.id} visit={visit} t={t} locale={locale} past now={now} />
          ))}
        </section>
      ) : null}

      {next ? (
        <section className="flex flex-col gap-2">
          <SectionHead title={t('account.home.nextVisit')} href="/compte/client/visites" linkLabel={t('account.home.seeAll')} />
          <VisitCard visit={next} t={t} locale={locale} compact now={now} />
        </section>
      ) : null}
    </>
  );
}

function InboxSkeleton() {
  return (
    <>
      <div className="grid grid-cols-3 gap-2.5">
        <Block className="h-[4.75rem]" />
        <Block className="h-[4.75rem]" />
        <Block className="h-[4.75rem]" />
      </div>
      <Block className="h-40" />
    </>
  );
}

/**
 * New listings for the customer's saved searches. Re-runs the searches
 * (getSavedSearchMatches, four at a time) but never stamps them viewed: only
 * the Alertes tab does that, so its "N nouveaux" are still there after this.
 */
async function AlertsRail({ customerId }) {
  const t = await getT();
  const searches = await listSavedSearches(customerId);
  if (!searches.length) return null;
  let matches = [];
  try {
    matches = await getSavedSearchMatches(searches, { limit: 24 });
  } catch (err) {
    console.warn('[compte/client] alert matches unavailable:', err.message);
    return null;
  }
  const { listings, total } = freshAlertListings(matches);
  if (!listings.length) return null;
  return (
    <section className="flex flex-col gap-1">
      <SectionHead title={t('account.home.newForAlerts')} href="/compte/client/favoris?tab=alertes" linkLabel={t('account.home.seeAll')} />
      <p className="-mt-2 text-[0.8125rem] text-ink-45">{t('account.home.sinceLastVisit', { count: total })}</p>
      <div className="-mx-4 mt-2 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
        {listings.map((listing) => (
          <ClientMiniListingCard key={listing.id} listing={listing} t={t} />
        ))}
      </div>
    </section>
  );
}

/**
 * "Mon déménagement" (2026-11-07): each of the customer's moves (up to five)
 * as a row that opens it, with its own "Modifier" — so editing a project is
 * always one tap from Accueil — and "Nouveau projet" while there is room. For
 * someone who has not told us yet (WhatsApp signup, skipped every card,
 * older account), an invitation to the cards.
 */
async function MoveProjectCard({ customerId }) {
  const t = await getT();
  let projects = [];
  try {
    projects = await listMoveProjects(customerId);
  } catch (err) {
    console.warn('[compte/client] move projects unavailable:', err.message);
    return null;
  }
  if (!projects.length) {
    return (
      <Link href="/compte/client/projet/nouveau" className={`u-press flex items-center gap-3 p-4 ${CARD}`}>
        <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-blue text-white">
          <Truck strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] font-bold text-ink">{t('account.move.home.inviteTitle')}</span>
          <span className="text-[0.8125rem] text-ink-45">{t('account.move.home.inviteLead')}</span>
        </span>
        <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem] flex-none text-ink-35" aria-hidden="true" />
      </Link>
    );
  }
  const checkin = projects.find((p) => checkinDue(p));
  return (
    <>
    {checkin ? (
      <Link href={`/compte/client/projet/${checkin.id}#checkin`} className="u-press flex items-center gap-3 rounded-card bg-green-tint p-4">
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] font-bold text-green-deep">{t('account.move.checkin.title')}</span>
          <span className="text-[0.8125rem] text-ink-70">{t('account.move.checkin.homePrompt')}</span>
        </span>
        <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem] flex-none text-green-deep" aria-hidden="true" />
      </Link>
    ) : null}
    <section className={`flex flex-col p-4 ${CARD}`} aria-labelledby="home-move">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="home-move" className="u-title-card flex items-center gap-2 text-ink">
          <Truck strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem] text-blue" aria-hidden="true" />
          {t('account.move.home.title')}
        </h2>
        <Link href="/compte/client/projet" className="inline-flex min-h-11 items-center text-[0.8125rem] font-bold text-blue hover:underline">
          {t('account.home.seeAll')}
        </Link>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {projects.map((project, index) => {
          const name = projectDisplayName(project, {
            reasonLabel: (r) => t(`account.move.steps.reasons.options.${r}`),
            fallback: t('account.move.list.untitled', { n: index + 1 }),
          });
          return (
            <li key={project.id} className="flex items-center gap-2">
              <Link href={`/compte/client/projet/${project.id}`} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 py-2">
                <span className="block min-w-0 flex-1 truncate text-[0.9375rem] font-semibold text-ink">{name}</span>
                {project.status !== 'active' ? (
                  <span className={`flex-none rounded-full px-2 py-0.5 text-[0.71875rem] font-bold ${project.status === 'found' ? 'bg-green-tint text-green-deep' : 'bg-canvas-deep text-ink-70'}`}>
                    {t(`account.move.status.chip.${project.status}`)}
                  </span>
                ) : null}
                <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 flex-none text-ink-35" aria-hidden="true" />
              </Link>
              <Link
                href={`/compte/client/projet/${project.id}/modifier`}
                aria-label={`${t('account.move.page.edit')} — ${name}`}
                className="grid h-11 w-11 flex-none place-items-center rounded-full text-blue hover:bg-blue-tint"
              >
                <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
      {projects.length < MAX_MOVE_PROJECTS ? (
        <Link href="/compte/client/projet/nouveau" className="mt-1 inline-flex min-h-11 items-center gap-1.5 self-start text-[0.875rem] font-bold text-blue hover:underline">
          <Plus strokeWidth={2.5} className="h-4 w-4" aria-hidden="true" />
          {t('account.move.list.new')}
        </Link>
      ) : null}
    </section>
    </>
  );
}

/** Where the customer's "Trouver pour moi" requests stand. */
async function RequestsSection({ customerId }) {
  const t = await getT();
  const rows = requestRows(await getCustomerInquiries(customerId));
  if (!rows.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <SectionHead title={t('account.home.requestsTitle')} href="/compte/client/messages" linkLabel={t('account.home.seeAll')} />
      <ul className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <li key={row.id}>
            <Link href="/compte/client/messages" className={`u-press flex items-center gap-3 p-4 ${CARD}`}>
              <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-blue-tint text-blue">
                <Search strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-ink">{row.summary || t('account.home.requestUntitled')}</span>
                <span className="text-[0.8125rem] text-ink-45">
                  {row.proposals ? t('account.home.proposalsReceived', { count: row.proposals }) : t('account.home.waitingProposals')}
                </span>
              </span>
              <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem] flex-none text-ink-35" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Accueil (2026-10-05 redesign, web/Design/client-portal-prototype.html) — an
 * actionable inbox, not a page of numbers: the visit time the agent proposed,
 * the next confirmed visit, visits to rate, new listings for the alerts, where
 * the requests stand, and three ways to start looking. Every block that needs
 * the engine or a search streams under its own Suspense, so the greeting and
 * the quick actions paint at once.
 *
 * Favoris & Alertes moved to /compte/client/favoris; the old `?tab=` links
 * (WhatsApp alert messages, /mises-a-jour, bookmarks) are sent there.
 */
export default async function EspaceClientHome({ searchParams }) {
  const params = await searchParams;
  if (params?.tab === 'alertes') redirect('/compte/client/favoris?tab=alertes');
  if (params?.tab === 'favoris') redirect('/compte/client/favoris');

  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client');
  const { customerId, customer } = session;
  const t = await getT();
  const counts = await getPortalCounts(customerId);
  const name = firstName(customer.full_name) || formatPhoneDisplay(customer.phone);

  const quick = [
    { href: '/listings', icon: Search, label: t('account.home.quick.search') },
    // One way to ask the agencies: the move project (lib/moveRequestHref.js).
    { href: await moveRequestHref(customerId), icon: Target, label: t('account.home.quick.findForMe') },
    { href: '/listings?view=map', icon: MapIcon, label: t('account.home.quick.map') },
  ];

  return (
    <div className="mx-auto flex max-w-[45rem] flex-col gap-4 sm:gap-5">
      {params?.motdepasse === 'change' ? (
        <p role="status" className="rounded-card bg-success-tint px-4 py-3 text-[0.875rem] font-semibold text-ink">
          {t('account.portal.passwordChanged')}
        </p>
      ) : null}
      <div>
        <h1 className="u-title-page text-ink">{t('account.portal.greeting', { name })}</h1>
        {customer.phone ? (
          <p className="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-ink-45">
            <ShieldCheck strokeWidth={ICON_STROKE_WIDTH} className="h-[0.9375rem] w-[0.9375rem] text-blue" aria-hidden="true" />
            {t('account.portal.accountLinkedTo', { phone: formatPhoneDisplay(customer.phone) })}
          </p>
        ) : null}
      </div>

      <Suspense fallback={<Block className="h-[4.5rem]" />}>
        <MoveProjectCard customerId={customerId} />
      </Suspense>

      {/* "N nouveaux biens depuis votre dernière visite" (client-only). */}
      <NewSinceLastVisit />

      <Suspense fallback={<InboxSkeleton />}>
        <InboxSection customerId={customerId} counts={counts} />
      </Suspense>

      <Suspense fallback={null}>
        <AlertsRail customerId={customerId} />
      </Suspense>

      <Suspense fallback={null}>
        <RequestsSection customerId={customerId} />
      </Suspense>

      <div className="grid grid-cols-3 gap-2.5">
        {quick.map(({ href, icon: Icon, label }) => (
          <Link key={href} href={href} className={`u-press flex min-h-[5.25rem] flex-col items-center justify-center gap-2 p-2 text-center text-[0.78125rem] font-bold text-ink ${CARD}`}>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-tint text-blue">
              <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
            </span>
            {label}
          </Link>
        ))}
      </div>

      {counts.favorites === 0 && counts.alerts === 0 ? (
        <p className="flex items-start gap-2 rounded-xl bg-blue-tint px-4 py-3 text-[0.84375rem] text-blue-deep">
          <Heart strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
          <span>{t('account.home.startHint')}</span>
        </p>
      ) : null}
      {counts.alerts === 0 && counts.favorites > 0 ? (
        <p className="flex items-start gap-2 rounded-xl bg-blue-tint px-4 py-3 text-[0.84375rem] text-blue-deep">
          <Bell strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
          <span>{t('account.home.alertHint')}</span>
        </p>
      ) : null}
    </div>
  );
}
