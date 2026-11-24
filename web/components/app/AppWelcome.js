'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Bell, CalendarClock, Check, House, KeyRound } from 'lucide-react';
import { useIsLoggedIn } from '@/lib/customerClient';
import { saveSearch } from '@/lib/favorites';
import { buildSearchLabel } from '@/lib/searchLabel';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import {
  MAX_WELCOME_COMMUNES,
  WELCOME_COOKIE,
  WELCOME_MAX_AGE,
  WELCOME_PURPOSES,
  budgetChoices,
  formatWelcomeBudget,
  toggleCommune,
  welcomeSearchQuery,
} from '@/lib/welcomeRules';

const AuthPromptModal = dynamic(() => import('@/components/AuthPromptModal'), { ssr: false });

// The first question's tiles (WELCOME_PURPOSES values, lib/welcomeRules.js).
const PURPOSE_ICONS = { louer: KeyRound, acheter: House, courte: CalendarClock };
const CHIP = 'u-press u-focus-ring inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-[0.9375rem] font-semibold';
const CHIP_OFF = 'bg-surface text-ink ring-1 ring-inset ring-line';
const CHIP_ON = 'bg-blue text-white';

function markWelcomed() {
  try {
    document.cookie = `${WELCOME_COOKIE}=1; Max-Age=${WELCOME_MAX_AGE}; Path=/; SameSite=Lax`;
  } catch {
    // A refused cookie only means the questions come back next launch.
  }
}

/**
 * The app's first-open questions (lib/welcomeRules.js). One screen, three
 * questions in order, each answered with a tap; then the search is kept on
 * the device as the first saved search and the listings open. Alerts are
 * offered only after that — "On vous prévient dès qu'un bien correspond ?" —
 * because asked at launch, people refuse. "Passer" leaves at any time.
 */
export default function AppWelcome({ communes = [] }) {
  const t = useT();
  const router = useRouter();
  const loggedIn = useIsLoggedIn();
  const [purpose, setPurpose] = useState(null);
  const [budget, setBudget] = useState(undefined); // undefined = not answered, null = "Peu importe"
  const [picked, setPicked] = useState([]);
  const [done, setDone] = useState(null); // { href } once the search is built
  const [askAlert, setAskAlert] = useState(false);

  const budgets = purpose ? budgetChoices(purpose) : [];
  const needsBudget = budgets.length > 0;
  const budgetAnswered = !needsBudget || budget !== undefined;

  function finish() {
    const query = welcomeSearchQuery({ purpose, budget: budget ?? null, communes: picked });
    const href = `/listings${query ? `?${query}` : ''}`;
    try {
      saveSearch({ query, label: buildSearchLabel(new URLSearchParams(query), t), href });
    } catch {
      // The device refused storage: the listings still open.
    }
    markWelcomed();
    setDone({ href });
  }

  function skip() {
    markWelcomed();
    router.replace('/');
  }

  if (done) {
    return (
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-lg flex-col px-5 pb-10 pt-10">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-tint text-blue">
          <Bell strokeWidth={ICON_STROKE_WIDTH} className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="u-title-hero mt-6 text-balance text-ink">{t('appShell.welcome.alertTitle')}</h1>
        <p className="mt-3 text-[0.9375rem] text-ink-70">{t('appShell.welcome.alertText')}</p>
        <div className="mt-auto space-y-3 pt-10">
          <button
            type="button"
            onClick={() => (loggedIn ? router.replace(done.href) : setAskAlert(true))}
            className="u-press u-focus-ring flex h-12 w-full items-center justify-center rounded-xl bg-blue text-[0.9375rem] font-semibold text-white"
          >
            {t('appShell.welcome.alertYes')}
          </button>
          <button
            type="button"
            onClick={() => router.replace(done.href)}
            className="u-focus-ring flex h-11 w-full items-center justify-center text-[0.9375rem] font-semibold text-blue"
          >
            {t('appShell.welcome.alertLater')}
          </button>
        </div>
        {askAlert ? (
          <AuthPromptModal open={askAlert} onClose={() => setAskAlert(false)} trigger="alert" next={done.href} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-5 pb-28 pt-6">
      <div className="flex items-center justify-between">
        <h1 className="u-title-hero text-balance text-ink">{t('appShell.welcome.title')}</h1>
        <button type="button" onClick={skip} className="u-focus-ring min-h-11 px-2 text-[0.9375rem] font-semibold text-ink-70">
          {t('appShell.welcome.skip')}
        </button>
      </div>
      <p className="mt-2 text-[0.9375rem] text-ink-70">{t('appShell.welcome.lead')}</p>

      <fieldset className="mt-8">
        <legend className="text-[1.0625rem] font-bold text-ink">{t('appShell.welcome.purposeQuestion')}</legend>
        {/* The first answer is three large tiles: it is the one choice that
            shapes everything after it, and the screen is otherwise empty. */}
        <div className="mt-3 grid grid-cols-3 gap-2.5">
          {WELCOME_PURPOSES.map((p) => {
            const on = purpose === p.value;
            const Icon = PURPOSE_ICONS[p.value] || House;
            return (
              <button
                key={p.value}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setPurpose(p.value);
                  setBudget(undefined);
                }}
                className={cn(
                  'u-press flex min-h-[6.25rem] flex-col justify-between rounded-card p-3 text-left shadow-[var(--shadow-card)] transition-colors',
                  on ? 'bg-blue text-white' : 'bg-surface text-ink',
                )}
              >
                <Icon strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className={cn('h-6 w-6', on ? 'text-white' : 'text-ink-70')} />
                <span className="text-[0.9375rem] font-semibold leading-tight">{t(p.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {purpose && needsBudget ? (
        <fieldset className="mt-8">
          <legend className="text-[1.0625rem] font-bold text-ink">
            {t(purpose === 'acheter' ? 'appShell.welcome.budgetQuestionBuy' : 'appShell.welcome.budgetQuestionRent')}
          </legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {budgets.map((value) => {
              const on = budget === value;
              return (
                <button
                  key={value ?? 'any'}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setBudget(value)}
                  className={cn(CHIP, 'u-tabular', on ? CHIP_ON : CHIP_OFF)}
                >
                  {value == null ? t('appShell.welcome.anyBudget') : t('appShell.welcome.upTo', { amount: formatWelcomeBudget(value) })}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {purpose && budgetAnswered && communes.length ? (
        <fieldset className="mt-8">
          <legend className="text-[1.0625rem] font-bold text-ink">{t('appShell.welcome.communesQuestion')}</legend>
          <p className="mt-1 text-[0.8125rem] text-ink-70">{t('appShell.welcome.communesHint', { max: MAX_WELCOME_COMMUNES })}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {communes.map((name) => {
              const on = picked.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPicked((list) => toggleCommune(list, name))}
                  className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}
                >
                  {on ? <Check strokeWidth={2.25} className="h-4 w-4" aria-hidden="true" /> : null}
                  {name}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {purpose && budgetAnswered ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <button
            type="button"
            onClick={finish}
            className="u-press u-focus-ring mx-auto flex h-12 w-full max-w-lg items-center justify-center rounded-xl bg-blue text-[0.9375rem] font-semibold text-white"
          >
            {picked.length ? t('appShell.welcome.see') : t('appShell.welcome.seeAll')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
