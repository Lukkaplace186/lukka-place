import Link from 'next/link';
import { ArrowRight, CalendarClock, ClipboardCheck, Home, MessageCircle, Search, Truck } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { groupCustomerVisits } from '@/lib/customerAgenda';
import VisitCard from '../visites/VisitCard';
import { SigningChecklist } from './ProjectJourney';

const CARD = 'rounded-card bg-surface shadow-[var(--hairline),var(--shadow-card)]';
const LINK = 'inline-flex min-h-11 items-center gap-1 text-sm font-bold text-blue hover:underline';

const MOVING_IN = ['power', 'water', 'keys', 'papers', 'address'];

function Shell({ icon: Icon, title, children }) {
  return (
    <section className={`flex flex-col gap-2 p-4 sm:p-5 ${CARD}`} aria-labelledby="move-stage-card">
      <h2 id="move-stage-card" className="u-title-card flex items-center gap-2 text-ink">
        <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem] text-blue" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * What matters at the move's current stage, right under the stepper (owner,
 * 2026-11-07): the next step, from the customer's real data only — their
 * matching homes, the requests they sent and what agencies answered, their
 * visits, then the checklists for signing and moving in. The full sections
 * stay further down the page.
 *
 * `inquiries` is getCustomerInquiries (memoised per request; the page already
 * read it for the stages), `since` the project's start in ms.
 */
export default function StageCard({ stage, project, inquiries = [], since = 0, t, locale, now = new Date() }) {
  const at = (value) => {
    if (!value) return 0;
    const text = String(value);
    const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(text) || text.includes('T') ? text : `${text.replace(' ', 'T')}Z`;
    return new Date(iso).getTime() || 0;
  };
  const recent = inquiries.filter(({ lead }) => lead && at(lead.created_at) >= since);

  if (stage === 'projet') {
    return (
      <Shell icon={Truck} title={t('account.move.stageCard.projet.title')}>
        <p className="text-[0.9375rem] text-ink-70">{t('account.move.stageCard.projet.body')}</p>
        <Link href={`/compte/client/projet/${project.id}/modifier`} className={LINK}>
          {t('account.move.page.edit')} <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
        </Link>
      </Shell>
    );
  }

  if (stage === 'recherche') {
    return (
      <Shell icon={Search} title={t('account.move.stageCard.recherche.title')}>
        <p className="text-[0.9375rem] text-ink-70">{t('account.move.stageCard.recherche.body')}</p>
        <div className="flex flex-wrap gap-x-4">
          <a href="#move-results" className={LINK}>{t('account.move.stageCard.recherche.seeHomes')}</a>
          {project.status === 'active' ? <a href="#move-request" className={LINK}>{t('account.move.page.request.cta')}</a> : null}
        </div>
      </Shell>
    );
  }

  if (stage === 'demande') {
    const proposals = recent.reduce((n, { proposals: p = [] }) => n + p.length, 0);
    return (
      <Shell icon={MessageCircle} title={t('account.move.stageCard.demande.title')}>
        <p className="text-[0.9375rem] text-ink">
          {t('account.move.stageCard.demande.counts', { requests: recent.length, proposals })}
        </p>
        <p className="text-[0.8125rem] text-ink-45">{t('account.move.page.request.followUp')}</p>
        <Link href="/compte/client/messages" className={LINK}>
          {t('account.move.page.request.seeMessages')} <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
        </Link>
      </Shell>
    );
  }

  if (stage === 'visites') {
    const groups = groupCustomerVisits(recent, now);
    const coming = [...groups.today, ...groups.tomorrow, ...groups.upcoming, ...groups.unscheduled].slice(0, 2);
    return (
      <>
        <Shell icon={CalendarClock} title={t('account.move.stageCard.visites.title')}>
          {coming.length ? (
            <div className="flex flex-col gap-2">
              {coming.map((visit) => <VisitCard key={visit.id} visit={visit} t={t} locale={locale} compact now={now} />)}
            </div>
          ) : (
            <p className="text-[0.9375rem] text-ink-70">{t('account.move.stageCard.visites.none')}</p>
          )}
          <Link href="/compte/client/visites" className={LINK}>
            {t('account.move.stageCard.visites.all')} <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Shell>
        <SigningChecklist t={t} />
      </>
    );
  }

  if (stage === 'trouve') {
    return (
      <Shell icon={ClipboardCheck} title={t('account.move.stageCard.trouve.title')}>
        <p className="text-[0.9375rem] text-ink-70">{t('account.move.stageCard.trouve.body')}</p>
        <ul className="mt-1 flex flex-col gap-2">
          {MOVING_IN.map((key) => (
            <li key={key} className="flex items-start gap-2 text-[0.9375rem] text-ink">
              <span className="mt-1 h-2 w-2 flex-none rounded-full bg-blue" aria-hidden="true" />
              {t(`account.move.stageCard.trouve.items.${key}`)}
            </li>
          ))}
        </ul>
      </Shell>
    );
  }

  if (stage === 'installe') {
    return (
      <Shell icon={Home} title={t('account.move.stageCard.installe.title')}>
        <p className="text-[0.9375rem] text-ink-70">{t('account.move.stageCard.installe.body')}</p>
      </Shell>
    );
  }
  return null;
}
