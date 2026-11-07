'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { ArrowLeft, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/client';
import { getSavedSearches } from '@/lib/localFavorites';
import SafeImage from '@/components/SafeImage';
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
  usd,
} from '@/lib/moveProjectRules';

/**
 * "Mon déménagement" — the card-by-card questions (2026-11-07). Five cards
 * (owner, same day: ten felt excessive), each a screen of big chips, a
 * progress bar, swipe or "Suivant"; every card can be skipped, and "Créer mon
 * compte directement" jumps to the last card from anywhere (the owner cut
 * signup to three fields on 2026-11-06 because extra steps lost customers —
 * nothing here may become a wall).
 *
 *   reasons · search (rent/buy, bedrooms, household) · place (communes + the
 *   place that matters) · budget (an adjustable range, with the homes it
 *   finds, live) · details (timeline, priorities, current home)
 *
 * mode 'signup': the last card is the account form (SignupForm with
 *   `signupProps`, the answers in a hidden `moveProject` field), and answers
 *   survive a reload or an error redirect in localStorage.
 * mode 'edit': the last card saves the project through `saveAction`.
 *
 * Answers are codes from lib/moveProjectRules.js; the server re-validates
 * everything (parseMoveProject).
 */

const DRAFT_KEY = 'lukka_move_draft_v2';
const PREVIEW_DEBOUNCE_MS = 450;

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

function Chip({ selected, onClick, children, disabled = false, small = false }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'u-press inline-flex items-center gap-2 rounded-full border text-left font-semibold transition-colors',
        small ? 'min-h-11 px-3.5 py-2 text-[0.875rem]' : 'min-h-12 px-4 py-2.5 text-[0.9375rem]',
        selected ? 'border-blue bg-blue text-white' : 'border-line bg-surface text-ink hover:border-blue',
        disabled && !selected ? 'opacity-45' : null,
      )}
    >
      {selected ? <Check strokeWidth={2.5} aria-hidden="true" className="h-4 w-4 flex-none" /> : null}
      {children}
    </button>
  );
}

function Group({ label, children, className }) {
  return (
    <fieldset className={cn('flex flex-col gap-2', className)}>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-45">{label}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

const FIELD = 'u-focus-ring min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-[0.9375rem] text-ink';

function CommuneSelect({ id, value, onChange, placeholder }) {
  return (
    <select id={id} value={value || ''} onChange={(e) => onChange(e.target.value || null)} className={FIELD}>
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

/** One home in the budget card's live preview, with why it is "close" when it is. */
function PreviewRow({ item, t }) {
  const tagText = (tag) => {
    if (tag.kind === 'above') return t('account.move.matches.tags.above', { pct: tag.pct });
    if (tag.kind === 'below') return t('account.move.matches.tags.below', { pct: tag.pct });
    return t('account.move.matches.tags.nearby', { commune: tag.commune, km: tag.km });
  };
  return (
    <Link href={item.href} target="_blank" className="u-press flex items-center gap-3 rounded-xl bg-surface p-2 shadow-[var(--hairline)]">
      <span className="relative h-16 w-16 flex-none overflow-hidden rounded-lg bg-canvas-deep">
        {item.image ? <SafeImage src={item.image} alt="" fill sizes="64px" className="object-cover" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="u-tabular block text-[0.9375rem] font-extrabold text-ink">
          {item.amount}
          {item.period ? <span className="ml-1 text-[0.75rem] font-medium text-ink-45">{item.period}</span> : null}
        </span>
        {item.place ? <span className="block truncate text-[0.8125rem] text-ink-70">{item.place}</span> : null}
        {item.tags?.length ? (
          <span className="mt-0.5 flex flex-wrap gap-1">
            {item.tags.map((tag) => (
              <span key={`${tag.kind}-${tag.pct ?? tag.commune}`} className="rounded-full bg-amber-50 px-2 py-0.5 text-[0.71875rem] font-bold text-amber-800">
                {tagText(tag)}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

/**
 * Live answer to "what does this budget find?" (/api/move/matches): the count
 * of exact matches and the first few, then — when few match — the closest
 * homes, each saying why it is close. Never counted together.
 */
function BudgetPreview({ answers, t }) {
  const [state, setState] = useState({ status: 'idle', data: null });
  const key = JSON.stringify({
    transaction: answers.transaction, city: answers.city, communes: answers.communes,
    bedrooms: answers.bedrooms, budgetMin: answers.budgetMin, budgetMax: answers.budgetMax,
  });

  useEffect(() => {
    const body = JSON.parse(key);
    if (!body.transaction && !(body.communes || []).length) {
      setState({ status: 'idle', data: null });
      return undefined;
    }
    const controller = new AbortController();
    setState((s) => ({ status: 'loading', data: s.data }));
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/move/matches', { method: 'POST', body: key, signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        setState({ status: 'ready', data: await res.json() });
      } catch (err) {
        if (err.name !== 'AbortError') setState({ status: 'error', data: null });
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  const { status, data } = state;
  if (status === 'idle') return null;
  return (
    <section className="mt-5 flex flex-col gap-2" aria-live="polite">
      {status === 'error' ? <p className="text-sm text-ink-70">{t('account.move.matches.error')}</p> : null}
      {data ? (
        <>
          <p className={cn('text-[0.9375rem] font-bold', data.total ? 'text-green-deep' : 'text-ink')}>
            {data.total ? t('account.move.matches.count', { count: data.total }) : t('account.move.matches.none')}
          </p>
          {data.exact.map((item) => <PreviewRow key={item.id} item={item} t={t} />)}
          {data.close.length ? (
            <>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-ink-45">{t('account.move.matches.closeTitle')}</p>
              {data.close.map((item) => <PreviewRow key={item.id} item={item} t={t} />)}
            </>
          ) : null}
        </>
      ) : null}
      {status === 'loading' ? <p className="text-[0.8125rem] text-ink-45">{t('account.move.matches.loading')}</p> : null}
    </section>
  );
}

const EMPTY = Object.freeze({
  reasons: [], reasonOther: '', transaction: null, household: null, bedrooms: null,
  anchorKind: null, anchorCommune: null, anchorNote: '', city: null, communes: [],
  priorities: [], budgetMin: null, budgetMax: null, timeline: null, currentHomeType: null, currentCommune: null,
});

export default function MoveOnboarding({ mode = 'signup', initialAnswers = null, startAtEnd = false, signupProps = null, accountFooter = null, saveAction = null, saveError = false }) {
  const t = useT();
  const [answers, setAnswers] = useState(() => ({ ...EMPTY, ...(initialAnswers || {}) }));
  const [answered, setAnswered] = useState(() => new Set(initialAnswers?.answeredSteps || []));
  const [skipped, setSkipped] = useState([]);
  const [stepKey, setStepKey] = useState(startAtEnd ? 'end' : MOVE_STEPS[0]);
  const [communeLimitHit, setCommuneLimitHit] = useState(false);
  const touch = useRef(null);
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
    const said = new Set();
    if (fromSearch.transaction || fromSearch.bedrooms) said.add('search');
    if (fromSearch.communes?.length) said.add('place');
    if (fromSearch.budgetMin || fromSearch.budgetMax) said.add('budget');
    setAnswered(said);
    // The search already says where: that card is skipped (budget stays —
    // its live preview is the point of the card).
    if (fromSearch.communes?.length) setSkipped(['place']);
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

  function goTo(i) {
    const nextIndex = Math.min(Math.max(i, 0), steps.length - 1);
    setStepKey(steps[nextIndex]);
    setCommuneLimitHit(false);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }

  const mark = (step) => setAnswered((prev) => (prev.has(step) ? prev : new Set(prev).add(step)));
  const next = () => goTo(index + 1);
  const back = () => goTo(index - 1);
  const skip = () => {
    if (current !== 'end') setAnswered((prev) => { const n = new Set(prev); n.delete(current); return n; });
    next();
  };

  /** Single choice inside a card: tap again to clear. */
  function setOne(field, value, step) {
    setAnswers((a) => ({ ...a, [field]: a[field] === value ? null : value }));
    mark(step);
  }

  function toggleMany(field, value, step, max = Infinity) {
    const list = answers[field] || [];
    if (!list.includes(value) && list.length >= max) {
      setCommuneLimitHit(true);
      return;
    }
    setAnswers((a) => {
      const l = a[field] || [];
      return { ...a, [field]: l.includes(value) ? l.filter((v) => v !== value) : [...l, value] };
    });
    mark(step);
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
    // Never swipe away from a card while typing or scrolling a chip row.
    if (e.target.closest?.('input, select, textarea, a')) return;
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
  const budgetRules = MOVE_BUDGETS[answers.transaction];

  function setAnchorCommune(value) {
    setAnswers((a) => {
      const nextA = { ...a, anchorCommune: value };
      // The place that matters, offered as a commune to search — visibly
      // ticked on this same card, and the customer can untick it.
      const inCity = value && communesOfCity(a.city || DEFAULT_CITY).includes(value);
      if (inCity && !a.communes.includes(value) && a.communes.length < MAX_MOVE_COMMUNES) {
        nextA.communes = [...a.communes, value];
      }
      return nextA;
    });
    mark('place');
  }

  function setBudget(min, max) {
    setAnswers((a) => ({ ...a, budgetMin: min, budgetMax: max }));
    mark('budget');
  }

  function budgetField(which, raw) {
    const n = Math.round(Number(String(raw).replace(/[\s$,]/g, '')));
    const value = Number.isFinite(n) && n > 0 ? Math.min(n, budgetRules.cap) : null;
    setAnswers((a) => ({ ...a, [which]: value }));
    mark('budget');
  }

  let body = null;
  switch (current) {
    case 'reasons':
      body = (
        <>
          <p className="u-micro mb-3 text-ink-45">{t('account.move.multiHint')}</p>
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
              className={cn(FIELD, 'mt-3')}
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
    case 'search':
      body = (
        <div className="flex flex-col gap-5">
          <Group label={s('search.transactionLabel')}>
            {MOVE_TRANSACTIONS.map((v) => (
              <Chip key={v} small selected={answers.transaction === v} onClick={() => setOne('transaction', v, 'search')}>
                {s(`transaction.options.${v}`)}
              </Chip>
            ))}
          </Group>
          <Group label={s('search.bedroomsLabel')}>
            {MOVE_BEDROOMS.map((n) => (
              <Chip key={n} small selected={answers.bedrooms === n} onClick={() => setOne('bedrooms', n, 'search')}>
                {n === 5 ? s('bedrooms.max') : String(n)}
              </Chip>
            ))}
          </Group>
          <Group label={s('search.householdLabel')}>
            {MOVE_HOUSEHOLDS.map((v) => (
              <Chip key={v} small selected={answers.household === v} onClick={() => setOne('household', v, 'search')}>
                {s(`household.options.${v}`)}
              </Chip>
            ))}
          </Group>
        </div>
      );
      break;
    case 'place':
      body = (
        <>
          <label htmlFor="move-city" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
            {s('communes.cityLabel')}
          </label>
          <select
            id="move-city"
            value={city}
            onChange={(e) => { setAnswers((a) => ({ ...a, city: e.target.value, communes: [] })); mark('place'); }}
            className={cn(FIELD, 'mb-4')}
          >
            {CITIES.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            {cityCommunes.map((key) => (
              <Chip
                key={key}
                small
                selected={answers.communes.includes(key)}
                disabled={answers.communes.length >= MAX_MOVE_COMMUNES}
                onClick={() => toggleMany('communes', key, 'place', MAX_MOVE_COMMUNES)}
              >
                {communeLabel(key)}
              </Chip>
            ))}
          </div>
          {communeLimitHit ? <p className="mt-3 text-sm text-ink-70" role="status">{s('communes.limit')}</p> : null}

          <Group label={s('place.anchorQuestion')} className="mt-6">
            {MOVE_ANCHORS.map((v) => (
              <Chip key={v} small selected={answers.anchorKind === v} onClick={() => setOne('anchorKind', v, 'place')}>
                {s(`anchor.options.${v}`)}
              </Chip>
            ))}
          </Group>
          {answers.anchorKind && answers.anchorKind !== 'aucun' ? (
            <div className="u-reveal mt-3 flex flex-col gap-3">
              <div>
                <label htmlFor="move-anchor-commune" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
                  {s('anchor.communeLabel')}
                </label>
                <CommuneSelect id="move-anchor-commune" value={answers.anchorCommune} onChange={setAnchorCommune} placeholder={s('anchor.communePlaceholder')} />
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
                  className={FIELD}
                />
              </div>
            </div>
          ) : null}
        </>
      );
      break;
    case 'budget': {
      const presets = budgetRules?.presets || [];
      const isPreset = (lo, hi) => (answers.budgetMin ?? null) === lo && (answers.budgetMax ?? null) === hi;
      const presetLabel = (lo, hi) => {
        if (lo == null) return s('budget.presetUnder', { amount: usd(hi) });
        if (hi == null) return s('budget.presetOver', { amount: usd(lo) });
        return s('budget.presetBetween', { min: usd(lo), max: usd(hi) });
      };
      body = (
        <>
          <div className="flex flex-wrap gap-2">
            {presets.map(([lo, hi]) => (
              <Chip key={`${lo}-${hi}`} small selected={isPreset(lo, hi)} onClick={() => setBudget(lo, hi)}>
                {presetLabel(lo, hi)}
              </Chip>
            ))}
            <Chip small selected={false} onClick={() => setBudget(null, null)}>
              {s('budget.unknown')}
            </Chip>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {[['budgetMin', 'minLabel'], ['budgetMax', 'maxLabel']].map(([field, labelKey]) => (
              <div key={field}>
                <label htmlFor={`move-${field}`} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
                  {s(`budget.${labelKey}`)}
                </label>
                <input
                  id={`move-${field}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={budgetRules?.step}
                  value={answers[field] ?? ''}
                  onChange={(e) => budgetField(field, e.target.value)}
                  className={cn(FIELD, 'u-tabular')}
                />
              </div>
            ))}
          </div>
          <a href="/combien-coute" target="_blank" rel="noopener" className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-blue hover:underline">
            {s('budget.priceGuide')}
          </a>
          <BudgetPreview answers={answers} t={t} />
        </>
      );
      break;
    }
    case 'details':
      body = (
        <div className="flex flex-col gap-5">
          <Group label={s('details.timelineLabel')}>
            {MOVE_TIMELINES.map((v) => (
              <Chip key={v} small selected={answers.timeline === v} onClick={() => setOne('timeline', v, 'details')}>
                {s(`timeline.options.${v}`)}
              </Chip>
            ))}
          </Group>
          <Group label={s('details.prioritiesLabel')}>
            {MOVE_PRIORITIES.map((v) => (
              <Chip key={v} small selected={answers.priorities.includes(v)} onClick={() => toggleMany('priorities', v, 'details')}>
                {s(`priorities.options.${v}`)}
              </Chip>
            ))}
          </Group>
          <Group label={s('details.currentLabel')}>
            {MOVE_CURRENT_HOMES.map((v) => (
              <Chip key={v} small selected={answers.currentHomeType === v} onClick={() => setOne('currentHomeType', v, 'details')}>
                {s(`current.options.${v}`)}
              </Chip>
            ))}
          </Group>
          <div>
            <label htmlFor="move-current-commune" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              {s('current.communeLabel')}
            </label>
            <CommuneSelect
              id="move-current-commune"
              value={answers.currentCommune}
              onChange={(v) => { setAnswers((a) => ({ ...a, currentCommune: v })); mark('details'); }}
              placeholder={s('anchor.communePlaceholder')}
            />
          </div>
        </div>
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
