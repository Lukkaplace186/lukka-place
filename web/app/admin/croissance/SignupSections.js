import Link from 'next/link';
import { frNumber } from '@/lib/format';
import { PROMPT_ENTRIES, SIGNUP_REFUSALS } from '@/lib/signupFunnelRules';
import { Stat } from '../LeadRoutingUI';
import { TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../table/TableFrame';

/**
 * The 1,000-account goal and the sign-up funnel by entry (2026-11-11).
 * Data: lib/signupFunnel.js. Server Components; `t` is passed in.
 */

function percent(value) {
  return value == null ? '—' : `${frNumber(Math.round(value * 1000) / 10)} %`;
}

/** A thin bar towards the goal. */
function GoalBar({ percent: pct, label }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-canvas-alt" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <div className="h-full rounded-full bg-blue" style={{ width: `${Math.max(pct, pct > 0 ? 1 : 0)}%` }} />
    </div>
  );
}

function paceText(t, progress) {
  if (progress.remaining === 0) return t('admin.growth.signup.reached');
  if (progress.daysToGoal == null) return t('admin.growth.signup.etaNone');
  return t('admin.growth.signup.eta', { days: frNumber(progress.daysToGoal) });
}

/** Full card on /admin/croissance. */
export function SignupGoalCard({ t, progress }) {
  return (
    <section id="inscriptions" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="u-title-section text-ink">{t('admin.growth.signup.goalTitle', { goal: frNumber(progress.goal) })}</h2>
        <p className="u-micro text-ink-45">{paceText(t, progress)}</p>
      </div>
      <GoalBar percent={progress.percent} label={t('admin.growth.signup.goalTitle', { goal: frNumber(progress.goal) })} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={t('admin.growth.signup.total')} value={`${frNumber(progress.total)} / ${frNumber(progress.goal)}`} hint={`${frNumber(progress.percent)} %`} />
        <Stat label={t('admin.growth.signup.today')} value={frNumber(progress.today)} />
        <Stat label={t('admin.growth.signup.week')} value={frNumber(progress.week)} />
        <Stat label={t('admin.growth.signup.pace')} value={t('admin.growth.signup.perDay', { n: frNumber(progress.perDay) })} hint={t('admin.growth.signup.paceHint')} />
        <Stat label={t('admin.growth.signup.remaining')} value={frNumber(progress.remaining)} />
      </div>
    </section>
  );
}

/** One line on /admin/dashboard, linking to the full card. */
export function SignupGoalBanner({ t, progress }) {
  return (
    <Link href="/admin/croissance#inscriptions" className="mb-4 flex flex-col gap-2 rounded-card border border-line bg-surface p-4 hover:border-blue">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="u-title-card text-ink">
          {t('admin.growth.signup.bannerCount', { total: frNumber(progress.total), goal: frNumber(progress.goal) })}
        </span>
        <span className="u-micro text-ink-70">
          {t('admin.growth.signup.bannerLine', { today: frNumber(progress.today), week: frNumber(progress.week) })}
          {' · '}
          {paceText(t, progress)}
        </span>
      </div>
      <GoalBar percent={progress.percent} label={t('admin.growth.signup.goalTitle', { goal: frNumber(progress.goal) })} />
    </Link>
  );
}

const COLUMNS = [
  ['prompt_shown', 'shown'],
  ['prompt_open', 'opened'],
  ['form_view', 'formView'],
  ['form_start', 'formStart'],
  ['submit', 'submit'],
  ['refused', 'refused'],
  ['created', 'created'],
];

/** The funnel by entry, then what sends people back. */
export function SignupFunnelSection({ t, funnel }) {
  if (!funnel.measured) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="u-title-card text-ink">{t('admin.growth.signup.funnelTitle')}</h2>
        <p className="u-micro text-ink-45">{t('admin.growth.signup.notMeasured')}</p>
      </section>
    );
  }

  const refusalTotal = Object.values(funnel.refusals).reduce((a, b) => a + b, 0);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="u-title-card text-ink">{t('admin.growth.signup.funnelTitle')}</h2>
      <p className="u-micro max-w-[75ch] text-ink-45">{t('admin.growth.signup.funnelLead')}</p>
      {funnel.entries.length === 0 ? (
        <p className="u-micro text-ink-45">{t('admin.growth.signup.noEvents')}</p>
      ) : (
        <TableFrame minWidth="52rem">
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.growth.signup.columns.entry')}</th>
              {COLUMNS.map(([step, key]) => (
                <th key={step} className={`${TH_STICKY} text-right`}>{t(`admin.growth.signup.columns.${key}`)}</th>
              ))}
              <th className={`${TH_STICKY} text-right`}>{t('admin.growth.signup.columns.conversion')}</th>
            </tr>
          </thead>
          <tbody>
            {funnel.entries.map((row) => {
              const isPrompt = PROMPT_ENTRIES.has(row.entry);
              return (
                <tr key={row.entry} className={TR_DENSE}>
                  <td className={TD_DENSE}>{t(`admin.growth.signup.entries.${row.entry}`)}</td>
                  {COLUMNS.map(([step]) => {
                    const promptStep = step === 'prompt_shown' || step === 'prompt_open';
                    return (
                      <td key={step} className={`${TD_DENSE} u-tabular text-right ${step === 'created' ? 'font-bold text-ink' : ''}`}>
                        {promptStep && !isPrompt ? '—' : frNumber(row[step])}
                      </td>
                    );
                  })}
                  <td className={`${TD_DENSE} u-tabular text-right`}>{percent(row.conversion)}</td>
                </tr>
              );
            })}
          </tbody>
        </TableFrame>
      )}
      {funnel.unmeasured > 0 ? (
        <p className="u-micro text-ink-45">{t('admin.growth.signup.unmeasured', { n: frNumber(funnel.unmeasured) })}</p>
      ) : null}

      <h3 className="u-title-sub mt-3 text-ink">{t('admin.growth.signup.refusalsTitle')}</h3>
      {refusalTotal === 0 ? (
        <p className="u-micro text-ink-45">{t('admin.growth.signup.noRefusals')}</p>
      ) : (
        <ul className="u-micro flex flex-wrap gap-2 text-ink-70">
          {SIGNUP_REFUSALS.filter((reason) => funnel.refusals[reason]).map((reason) => (
            <li key={reason} className="rounded-full border border-line bg-surface px-3 py-1">
              {t(`admin.growth.signup.refusals.${reason}`)} : <strong className="u-tabular text-ink">{frNumber(funnel.refusals[reason])}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
