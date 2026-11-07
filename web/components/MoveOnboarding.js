'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ArrowLeft, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/client';
import { getSavedSearches } from '@/lib/localFavorites';
import SignupForm from '@/app/(site)/compte/inscription/SignupForm';
import { CITIES, DEFAULT_CITY, communeLabel, communesOfCity } from '@/lib/cities';
import {
  MAX_MOVE_COMMUNES,
  MAX_MOVE_NOTE,
  MOVE_ANCHORS,
  MOVE_BEDROOMS,
  MOVE_BUDGETS,
  MOVE_CURRENT_HOMES,
  MOVE_HOUSEHOLDS,
  MOVE_PRIORITIES,
  MOVE_REASONS,
  MOVE_STEPS,
  MOVE_TIMELINES,
  MOVE_TRANSACTIONS,
  projectFromSearchQuery,
} from '@/lib/moveProjectRules';

/**
 * "Mon déménagement" — the card-by-card questions (2026-11-07). One question
 * per screen, big chips, a progress bar, swipe or "Suivant"; every card can
 * be skipped, and "Créer mon compte directement" jumps to the last card from
 * anywhere (the owner cut signup to three fields on 2026-11-06 because extra
 * steps lost customers — nothing here may become a wall).
 *
 * mode 'signup': the last card is the account form (SignupForm with
 *   `signupProps`, the answers in a hidden `moveProject` field), and answers
 *   survive a reload or an error redirect in localStorage.
 * mode 'edit': the last card saves the project through `saveAction`.
 *
 * Answers are codes from lib/moveProjectRules.js; the server re-validates
 * everything (parseMoveProject).
 */

const DRAFT_KEY = 'lukka_move_draft_v1';
const SINGLE_ADVANCE_MS = 260;

function readDraft() {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeDraft(value) {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(value));
  } catch {
    // Private window / blocked storage: the flow still works, it just won't resume.
  }
}

export function clearMoveDraft() {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

/** Fire-and-forget "card reached" beacon — the drop-off measure. */
function beacon(payload) {
  try {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) navigator.sendBeacon('/api/telemetry/onboarding', new Blob([body], { type: 'application/json' }));
  } catch {
    // never blocks the flow
  }
}

function Chip({ selected, onClick, children, disabled = false }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'u-press inline-flex min-h-12 items-center gap-2 rounded-full border px-4 py-2.5 text-left text-[0.9375rem] font-semibold transition-colors',
        selected ? 'border-blue bg-blue text-white' : 'border-line bg-surface text-ink hover:border-blue',
        disabled && !selected ? 'opacity-45' : null,
      )}
    >
      {selected ? <Check strokeWidth={2.5} aria-hidden="true" className="h-4 w-4 flex-none" /> : null}
      {children}
    </button>
  );
}

function CommuneSelect({ id, value, onChange, placeholder }) {
  return (
    <select
      id={id}
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="u-focus-ring min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-[0.9375rem] text-ink"
    >
      <option value="">{placeholder}</option>
      {CITIES.map((city) => (
        <optgroup key={city.name} label={city.name}>
          {city.communes.map((c) => (
            <option key={c.key} value={c.key}>{communeLabel(c.key)}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function SaveButton({ label, pendingLabel }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="u-btn-primary min-h-12 w-full rounded-md bg-blue px-4 text-[0.9375rem] font-bold text-white hover:bg-blue-deep disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

const EMPTY = Object.freeze({
  reasons: [], reasonOther: '', transaction: null, household: null, bedrooms: null,
  anchorKind: null, anchorCommune: null, anchorNote: '', city: null, communes: [],
  priorities: [], budgetMax: null, timeline: null, currentHomeType: null, currentCommune: null,
});

export default function MoveOnboarding({ mode = 'signup', initialAnswers = null, startAtEnd = false, signupProps = null, accountFooter = null, saveAction = null, saveError = false }) {
  const t = useT();
  const [answers, setAnswers] = useState(() => ({ ...EMPTY, ...(initialAnswers || {}) }));
  const [answered, setAnswered] = useState(() => new Set(initialAnswers?.answeredSteps || []));
  const [skipped, setSkipped] = useState([]);
  const [stepKey, setStepKey] = useState(startAtEnd ? 'end' : MOVE_STEPS[0]);
  const [communeLimitHit, setCommuneLimitHit] = useState(false);
  const touch = useRef(null);
  const advanceTimer = useRef(null);
  const restored = useRef(false);
  // The drop-off beacon waits for the draft to be restored, or a reload would
  // log card 1 again before jumping back to where the customer was.
  const [ready, setReady] = useState(mode !== 'signup');

  // Signup only: resume a draft, or start from the search the visitor saved
  // before the sign-up prompt (that search already says where and how much).
  useEffect(() => {
    if (mode !== 'signup' || restored.current) return;
    restored.current = true;
    setReady(true);
    const draft = readDraft();
    if (draft?.answers) {
      setAnswers({ ...EMPTY, ...draft.answers });
      setAnswered(new Set(draft.answered || []));
      setSkipped(draft.skipped || []);
      if (!startAtEnd && draft.stepKey) setStepKey(draft.stepKey);
      return;
    }
    const latest = getSavedSearches()[0];
    if (!latest?.query) return;
    const fromSearch = projectFromSearchQuery(latest.query);
    if (!Object.keys(fromSearch).length) return;
    setAnswers((a) => ({ ...a, ...fromSearch }));
    const skip = [];
    if (fromSearch.communes?.length) skip.push('communes');
    if (fromSearch.budgetMax) skip.push('budget');
    setSkipped(skip);
    const said = { transaction: 'transaction', communes: 'communes', bedrooms: 'bedrooms', budgetMax: 'budget' };
    setAnswered(new Set(Object.keys(fromSearch).map((k) => said[k]).filter(Boolean)));
  }, [mode, startAtEnd]);

  const steps = useMemo(() => {
    const list = MOVE_STEPS.filter((s) => {
      if (skipped.includes(s)) return false;
      if (s === 'budget' && !MOVE_BUDGETS[answers.transaction]) return false;
      return true;
    });
    return [...list, 'end'];
  }, [skipped, answers.transaction]);

  const index = Math.max(0, steps.indexOf(stepKey));
  const current = steps[index];
  const total = steps.length;

  useEffect(() => {
    if (mode === 'signup' && restored.current) {
      writeDraft({ answers, answered: [...answered], skipped, stepKey: current });
    }
  }, [mode, answers, answered, skipped, current]);

  useEffect(() => {
    if (ready) beacon({ mode, step: current, index: index + 1, total });
  }, [ready, mode, current, index, total]);

  useEffect(() => () => clearTimeout(advanceTimer.current), []);

  function goTo(i) {
    clearTimeout(advanceTimer.current);
    const nextIndex = Math.min(Math.max(i, 0), steps.length - 1);
    setStepKey(steps[nextIndex]);
    setCommuneLimitHit(false);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }

  function markAnswered(step, isAnswered = true) {
    setAnswered((prev) => {
      const next = new Set(prev);
      if (isAnswered) next.add(step);
      else next.delete(step);
      return next;
    });
  }

  const next = () => goTo(index + 1);
  const back = () => goTo(index - 1);
  const skip = () => {
    if (current !== 'end') markAnswered(current, false);
    next();
  };

  function setOne(field, value, step) {
    setAnswers((a) => ({ ...a, [field]: a[field] === value ? null : value }));
    markAnswered(step, true);
    clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => goTo(index + 1), SINGLE_ADVANCE_MS);
  }

  function toggleMany(field, value, step, max = Infinity) {
    setAnswers((a) => {
      const list = a[field] || [];
      if (list.includes(value)) return { ...a, [field]: list.filter((v) => v !== value) };
      if (list.length >= max) {
        setCommuneLimitHit(true);
        return a;
      }
      return { ...a, [field]: [...list, value] };
    });
    markAnswered(step, true);
  }

  function onTouchStart(e) {
    const p = e.touches?.[0];
    touch.current = p ? { x: p.clientX, y: p.clientY } : null;
  }
  function onTouchEnd(e) {
    const start = touch.current;
    const p = e.changedTouches?.[0];
    touch.current = null;
    if (!start || !p) return;
    const dx = p.clientX - start.x;
    const dy = p.clientY - start.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    // Never swipe away from a card with text fields mid-typing.
    if (e.target.closest?.('input, select, textarea')) return;
    if (dx < 0 && current !== 'end') next();
    if (dx > 0 && index > 0) back();
  }

  const city = answers.city || DEFAULT_CITY;
  const cityCommunes = communesOfCity(city);
  const answeredCount = [...answered].filter((s) => MOVE_STEPS.includes(s)).length;
  const hiddenValue = JSON.stringify({ ...answers, answeredSteps: MOVE_STEPS.filter((s) => answered.has(s)) });
  const hiddenField = <input type="hidden" name="moveProject" value={hiddenValue} />;
  const lastReason = answers.reasons[answers.reasons.length - 1];
  const s = (key, vars) => t(`account.move.steps.${key}`, vars);

  // Entering the communes card: offer the anchor's commune when nothing is
  // picked yet — a suggestion the customer sees selected and can untick.
  useEffect(() => {
    if (current !== 'communes' || answers.communes.length || !answers.anchorCommune) return;
    const anchorCity = CITIES.find((c) => c.communes.some((x) => x.key === answers.anchorCommune));
    if (!anchorCity) return;
    setAnswers((a) => ({ ...a, city: anchorCity.name, communes: [a.anchorCommune] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  let body = null;
  let multi = false;
  switch (current) {
    case 'reasons':
      multi = true;
      body = (
        <>
          <div className="flex flex-wrap gap-2">
            {MOVE_REASONS.map((r) => (
              <Chip key={r} selected={answers.reasons.includes(r)} onClick={() => toggleMany('reasons', r, 'reasons')}>
                {s(`reasons.options.${r}`)}
              </Chip>
            ))}
          </div>
          {answers.reasons.includes('autre') ? (
            <input
              type="text"
              value={answers.reasonOther}
              maxLength={MAX_MOVE_NOTE}
              onChange={(e) => setAnswers((a) => ({ ...a, reasonOther: e.target.value }))}
              placeholder={s('reasons.otherPlaceholder')}
              aria-label={s('reasons.otherPlaceholder')}
              className="u-focus-ring mt-3 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-[0.9375rem] text-ink"
            />
          ) : null}
          {lastReason ? (
            <p key={lastReason} className="u-reveal mt-4 rounded-xl bg-blue-tint px-4 py-3 text-[0.9375rem] font-semibold text-blue-deep" role="status">
              {s(`reasons.cheers.${lastReason}`)}
            </p>
          ) : null}
        </>
      );
      break;
    case 'transaction':
      body = (
        <div className="flex flex-col gap-2">
          {MOVE_TRANSACTIONS.map((v) => (
            <Chip key={v} selected={answers.transaction === v} onClick={() => setOne('transaction', v, 'transaction')}>
              {s(`transaction.options.${v}`)}
            </Chip>
          ))}
        </div>
      );
      break;
    case 'household':
      body = (
        <div className="flex flex-wrap gap-2">
          {MOVE_HOUSEHOLDS.map((v) => (
            <Chip key={v} selected={answers.household === v} onClick={() => setOne('household', v, 'household')}>
              {s(`household.options.${v}`)}
            </Chip>
          ))}
        </div>
      );
      break;
    case 'bedrooms':
      body = (
        <div className="flex flex-wrap gap-2">
          {MOVE_BEDROOMS.map((n) => (
            <Chip key={n} selected={answers.bedrooms === n} onClick={() => setOne('bedrooms', n, 'bedrooms')}>
              {n === 1 ? s('bedrooms.one') : n === 5 ? s('bedrooms.max') : s('bedrooms.many', { count: n })}
            </Chip>
          ))}
          <Chip selected={false} onClick={() => { setAnswers((a) => ({ ...a, bedrooms: null })); markAnswered('bedrooms', true); next(); }}>
            {s('bedrooms.unknown')}
          </Chip>
        </div>
      );
      break;
    case 'anchor':
      body = (
        <>
          <div className="flex flex-wrap gap-2">
            {MOVE_ANCHORS.map((v) => (
              <Chip
                key={v}
                selected={answers.anchorKind === v}
                onClick={() => {
                  if (v === 'aucun') {
                    setOne('anchorKind', v, 'anchor');
                  } else {
                    setAnswers((a) => ({ ...a, anchorKind: a.anchorKind === v ? null : v }));
                    markAnswered('anchor', true);
                  }
                }}
              >
                {s(`anchor.options.${v}`)}
              </Chip>
            ))}
          </div>
          {answers.anchorKind && answers.anchorKind !== 'aucun' ? (
            <div className="u-reveal mt-4 flex flex-col gap-3">
              <div>
                <label htmlFor="move-anchor-commune" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
                  {s('anchor.communeLabel')}
                </label>
                <CommuneSelect
                  id="move-anchor-commune"
                  value={answers.anchorCommune}
                  onChange={(v) => setAnswers((a) => ({ ...a, anchorCommune: v }))}
                  placeholder={s('anchor.communePlaceholder')}
                />
              </div>
              <div>
                <label htmlFor="move-anchor-note" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
                  {s('anchor.noteLabel')}
                </label>
                <input
                  id="move-anchor-note"
                  type="text"
                  value={answers.anchorNote}
                  maxLength={MAX_MOVE_NOTE}
                  onChange={(e) => setAnswers((a) => ({ ...a, anchorNote: e.target.value }))}
                  className="u-focus-ring min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-[0.9375rem] text-ink"
                />
              </div>
            </div>
          ) : null}
        </>
      );
      multi = Boolean(answers.anchorKind && answers.anchorKind !== 'aucun');
      break;
    case 'communes':
      multi = true;
      body = (
        <>
          <label htmlFor="move-city" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
            {s('communes.cityLabel')}
          </label>
          <select
            id="move-city"
            value={city}
            onChange={(e) => setAnswers((a) => ({ ...a, city: e.target.value, communes: [] }))}
            className="u-focus-ring mb-4 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-[0.9375rem] text-ink"
          >
            {CITIES.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            {cityCommunes.map((key) => (
              <Chip
                key={key}
                selected={answers.communes.includes(key)}
                disabled={answers.communes.length >= MAX_MOVE_COMMUNES}
                onClick={() => toggleMany('communes', key, 'communes', MAX_MOVE_COMMUNES)}
              >
                {communeLabel(key)}
              </Chip>
            ))}
          </div>
          {communeLimitHit ? <p className="mt-3 text-sm text-ink-70" role="status">{s('communes.limit')}</p> : null}
        </>
      );
      break;
    case 'priorities':
      multi = true;
      body = (
        <div className="flex flex-wrap gap-2">
          {MOVE_PRIORITIES.map((v) => (
            <Chip key={v} selected={answers.priorities.includes(v)} onClick={() => toggleMany('priorities', v, 'priorities')}>
              {s(`priorities.options.${v}`)}
            </Chip>
          ))}
        </div>
      );
      break;
    case 'budget': {
      const choices = MOVE_BUDGETS[answers.transaction] || [];
      body = (
        <>
          <div className="flex flex-wrap gap-2">
            {choices.map((amount) => (
              <Chip key={amount} selected={answers.budgetMax === amount} onClick={() => setOne('budgetMax', amount, 'budget')}>
                {s('budget.upTo', { amount: `$${amount.toLocaleString('en-US')}` })}
              </Chip>
            ))}
            <Chip selected={false} onClick={() => { setAnswers((a) => ({ ...a, budgetMax: null })); markAnswered('budget', true); next(); }}>
              {s('budget.unknown')}
            </Chip>
          </div>
          <a href="/combien-coute" target="_blank" rel="noopener" className="mt-4 inline-flex min-h-11 items-center text-sm font-bold text-blue hover:underline">
            {s('budget.priceGuide')}
          </a>
        </>
      );
      break;
    }
    case 'timeline':
      body = (
        <div className="flex flex-col gap-2">
          {MOVE_TIMELINES.map((v) => (
            <Chip key={v} selected={answers.timeline === v} onClick={() => setOne('timeline', v, 'timeline')}>
              {s(`timeline.options.${v}`)}
            </Chip>
          ))}
        </div>
      );
      break;
    case 'current':
      multi = true;
      body = (
        <>
          <div className="flex flex-wrap gap-2">
            {MOVE_CURRENT_HOMES.map((v) => (
              <Chip
                key={v}
                selected={answers.currentHomeType === v}
                onClick={() => { setAnswers((a) => ({ ...a, currentHomeType: a.currentHomeType === v ? null : v })); markAnswered('current', true); }}
              >
                {s(`current.options.${v}`)}
              </Chip>
            ))}
          </div>
          <label htmlFor="move-current-commune" className="mb-1 mt-4 block text-xs font-semibold uppercase tracking-wide text-ink-45">
            {s('current.communeLabel')}
          </label>
          <CommuneSelect
            id="move-current-commune"
            value={answers.currentCommune}
            onChange={(v) => { setAnswers((a) => ({ ...a, currentCommune: v })); markAnswered('current', true); }}
            placeholder={s('anchor.communePlaceholder')}
          />
        </>
      );
      break;
    default:
      body = null;
  }

  const isEnd = current === 'end';
  const titleKey = isEnd ? (mode === 'signup' ? 'account.move.account.title' : 'account.move.edit.title') : `account.move.steps.${current}.title`;
  let leadText;
  if (isEnd) {
    leadText = mode === 'signup'
      ? (answeredCount ? t('account.move.account.lead') : t('account.move.account.noAnswers'))
      : t('account.move.edit.lead');
  } else if (current === 'budget') {
    leadText = answers.transaction === 'vente' ? s('budget.leadBuy') : s('budget.leadRent');
  } else {
    leadText = s(`${current}.lead`);
  }

  return (
    <div
      className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md flex-col px-4 pb-6 pt-3"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={back}
          disabled={index === 0}
          aria-label={t('account.move.back')}
          className="u-press grid h-11 w-11 flex-none place-items-center rounded-full text-ink disabled:invisible"
        >
          <ArrowLeft strokeWidth={2} className="h-5 w-5" aria-hidden="true" />
        </button>
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index + 1}
          aria-label={t('account.move.progress', { current: index + 1, total })}
        >
          <div className="h-full rounded-full bg-blue transition-[width] duration-300" style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>
        {!isEnd ? (
          <button type="button" onClick={skip} className="u-press min-h-11 flex-none px-2 text-sm font-bold text-ink-45 hover:text-ink">
            {t('account.move.skip')}
          </button>
        ) : (
          <span className="w-11 flex-none" />
        )}
      </div>

      <div key={current} className="u-reveal mt-6 flex flex-1 flex-col">
        <p className="u-eyebrow text-blue">{t('account.move.eyebrow')} · {t('account.move.progress', { current: index + 1, total })}</p>
        <h1 className="u-title-section mt-2 text-ink">{t(titleKey)}</h1>
        <p className="mt-1.5 text-[0.9375rem] text-ink-45">{leadText}</p>
        {multi && current !== 'anchor' && current !== 'current' ? <p className="u-micro mt-1 text-ink-45">{t('account.move.multiHint')}</p> : null}

        <div className="mt-5">
          {!isEnd ? body : null}
          {isEnd && mode === 'signup' ? (
            <>
              {answeredCount ? (
                <p className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-green-tint px-3 py-1 text-[0.8125rem] font-bold text-green-deep">
                  <Check strokeWidth={2.5} className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('account.move.account.summary', { count: answeredCount })}
                </p>
              ) : null}
              {/* Clearing the draft on submit: an error redirect re-renders
                  the page and the draft is written again from state. */}
              <div onSubmitCapture={() => clearMoveDraft()}>
                {signupProps ? <SignupForm {...signupProps}>{hiddenField}</SignupForm> : null}
              </div>
              {accountFooter}
            </>
          ) : null}
          {isEnd && mode === 'edit' ? (
            <form action={saveAction} className="flex flex-col gap-3">
              {hiddenField}
              {saveError ? <p className="text-sm text-red-600" role="alert">{t('account.move.edit.error')}</p> : null}
              <SaveButton label={t('account.move.edit.save')} pendingLabel={t('account.move.edit.saving')} />
            </form>
          ) : null}
        </div>

        {!isEnd ? (
          <div className="mt-auto flex flex-col gap-2 pt-8">
            <button
              type="button"
              onClick={next}
              className="u-btn-primary min-h-12 w-full rounded-md bg-blue px-4 text-[0.9375rem] font-bold text-white hover:bg-blue-deep"
            >
              {t('account.move.next')}
            </button>
            {mode === 'signup' ? (
              <button type="button" onClick={() => goTo(steps.length - 1)} className="min-h-11 text-sm font-semibold text-ink-45 hover:text-ink hover:underline">
                {t('account.move.direct')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
