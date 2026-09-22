'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ArrowRight, Check, CircleAlert, Search, X } from 'lucide-react';
import { PortalPanel } from '@/components/ClientPortalUI';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { MAX_REQUEST_COMMUNES } from '@/lib/leadCommunes';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/client';

/**
 * "Soumettre une recherche" — the design's four-step request form.
 *
 * This writes a real lead through the same POST /admin/leads every other
 * visitor-initiated inquiry already uses (see ../actions.js), so a
 * submission genuinely reaches the team's conversations/leads dashboard and
 * comes back to the customer on the Messages tab. It is not a decorative
 * form.
 *
 * The commune list is passed in from the server and is real — the engine's
 * own kinshasa_locations.json hierarchy, falling back to communes derived
 * from the database when the engine is unreachable. Nothing here is a
 * hardcoded option list (web/CLAUDE.md).
 *
 * The design's step 4 uses a date picker; this uses a plain text field
 * because the value is free text on the engine's side too (the buyer
 * assistant's own `viewing_requests.requested_time` is free text for
 * exactly this reason — "dès que possible" is a real answer, not a slot).
 */
// Only the two word-bearing entries carry a key; the bare numerals are the
// same in both languages and stay literal rather than becoming pointless
// dictionary round-trips.
const BEDROOM_OPTIONS = [
  { value: 'studio', labelKey: 'account.requestForm.studio' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', labelKey: 'account.requestForm.bedrooms4plus' },
];

/*
 * `value` is the SUBMITTED text, and it is deliberately not translated: the
 * chosen option is stored as free text and appended verbatim to the request
 * description the partner agencies read (lib/customerPortal.js). Translating
 * the value would change what gets written to the database depending on the
 * customer's display language, and would not match rows already stored. Only
 * the visible label follows the language.
 */
const FLEXIBILITY_OPTIONS = [
  { value: 'Date ferme', labelKey: 'account.requestForm.dateFirm' },
  { value: 'Flexible à une semaine près', labelKey: 'account.requestForm.flexibleWeek' },
  { value: 'Flexible à un mois près', labelKey: 'account.requestForm.flexibleMonth' },
];

function Step({ number, title, hint, children }) {
  return (
    <div className="flex gap-4 sm:gap-[1.125rem]">
      <span className="flex h-[1.875rem] w-[1.875rem] shrink-0 items-center justify-center rounded-full bg-blue text-[0.8125rem] font-bold text-white">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[1rem] font-bold text-ink">{title}</h3>
        {hint ? <p className="mt-1.5 text-[0.8125rem] text-ink-45">{hint}</p> : null}
        <div className="mt-3.5">{children}</div>
      </div>
    </div>
  );
}

function SubmitButton() {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-6 py-3 text-[0.9375rem] font-semibold transition-colors',
        pending ? 'cursor-wait bg-canvas-deep text-ink-45' : 'u-btn-primary bg-blue text-white',
      )}
    >
      {pending ? t('common.actions.sending') : t('account.requestForm.submit')}
      {pending ? null : <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}

/** Accent/case-insensitive, so "ngiri" finds "Ngiri-Ngiri" and "kasa vubu" finds "Kasa-Vubu". */
function foldName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function CommuneChip({ name, active, disabled, onToggle }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(name)}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        disabled && 'cursor-not-allowed opacity-45',
        // Written out rather than composed on top of `.u-tag`: both `.u-tag`
        // and `bg-blue` are single-class utilities, so which one wins the
        // `background` declaration would come down to stylesheet order.
        'u-press inline-flex min-h-9 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[0.8125rem] font-medium transition-colors',
        active
          ? 'bg-blue text-white shadow-[inset_0_0_0_1px_var(--blue)]'
          : 'bg-surface text-ink-70 shadow-[inset_0_0_0_1px_var(--ink-25)] hover:text-ink',
      )}
    >
      {active ? <Check strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" /> : null}
      {name}
    </button>
  );
}

/**
 * All 24 communes as chips was a wall on a phone. The picker shows what is
 * chosen, then the communes that actually have listings (most first, from
 * getPopularCommunes), then the rest behind "Toutes les communes" — and a
 * search box that filters the full list. Every name still comes from the
 * real `communes` list; `popular` only orders it.
 */
function CommunePicker({ communes, popular, selected, onToggle, atCap }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const popularInList = useMemo(() => {
    const known = new Set(communes);
    return popular.filter((name) => known.has(name));
  }, [communes, popular]);

  const folded = foldName(query);
  let shown;
  if (folded) {
    shown = communes.filter((name) => foldName(name).includes(folded));
  } else if (showAll || popularInList.length === 0) {
    shown = communes;
  } else {
    shown = popularInList;
  }
  shown = shown.filter((name) => !selected.includes(name));
  const hiddenCount = communes.length - popularInList.length;

  return (
    <div className="flex flex-col gap-3">
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selected.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onToggle(name)}
              aria-label={t('account.requestForm.removeCommune', { name })}
              className="u-press inline-flex min-h-9 items-center gap-1.5 rounded-full bg-blue px-3 py-1.5 text-[0.8125rem] font-semibold text-white"
            >
              {name}
              <X strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}

      <div className="relative">
        <Search
          strokeWidth={ICON_STROKE_WIDTH}
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-35"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('account.requestForm.searchCommune')}
          aria-label={t('account.requestForm.searchCommune')}
          disabled={atCap}
          className="u-focus-ring h-11 w-full rounded-md border border-line bg-white pl-10 pr-3.5 text-[0.9375rem] text-ink placeholder:text-ink-35 disabled:bg-canvas-alt"
        />
      </div>

      {!folded && !showAll && popularInList.length > 0 ? (
        <p className="u-eyebrow">{t('account.requestForm.popularCommunes')}</p>
      ) : null}

      {shown.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {shown.map((name) => (
            <CommuneChip key={name} name={name} active={false} disabled={atCap} onToggle={onToggle} />
          ))}
        </div>
      ) : folded ? (
        <p className="text-[0.8125rem] text-ink-45">{t('account.requestForm.noCommuneMatch')}</p>
      ) : null}

      {!folded && popularInList.length > 0 && hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="w-fit text-[0.8125rem] font-semibold text-blue-deep hover:underline"
        >
          {showAll
            ? t('account.requestForm.fewerCommunes')
            : t('account.requestForm.allCommunes', { count: communes.length })}
        </button>
      ) : null}
    </div>
  );
}

const FIELD_CLASS =
  'u-focus-ring w-full rounded-md border border-line bg-white px-3.5 py-2.5 text-[0.9375rem] text-ink placeholder:text-ink-25';

/**
 * `prefill` (lib/requestPrefill.js) starts the form from the customer's most
 * recent saved search, and says so above the form, so nothing looks typed by
 * someone else. Every field stays editable.
 */
export default function RequestForm({ action, communes, popularCommunes = [], prefill = null }) {
  const t = useT();
  const [state, formAction] = useActionState(action, null);
  const [transactionType, setTransactionType] = useState(prefill?.transactionType || 'location');
  const [selectedCommunes, setSelectedCommunes] = useState(prefill?.communes || []);
  const [bedrooms, setBedrooms] = useState(prefill?.bedrooms || '');

  // Capped at the same number the server action and the engine enforce: every
  // commune is pushed to its own agencies, so the cap is what keeps a request
  // a targeted search. Past it, unselected chips are disabled rather than
  // silently ignored on submit.
  const atCommuneCap = selectedCommunes.length >= MAX_REQUEST_COMMUNES;

  function toggleCommune(name) {
    setSelectedCommunes((current) => {
      if (current.includes(name)) return current.filter((c) => c !== name);
      if (current.length >= MAX_REQUEST_COMMUNES) return current;
      return [...current, name];
    });
  }

  return (
    <PortalPanel className="p-5 sm:p-8">
      {/* The tab already names this on a phone. */}
      <h2 className="u-title-page hidden text-ink sm:block">
        {t('account.requestForm.title')}
      </h2>
      <p className="max-w-[32.5rem] sm:mt-3 text-[0.9375rem] leading-[1.6] text-ink-45">
        {t('account.requestForm.lead')}
      </p>

      {prefill ? (
        <p className="mt-4 rounded-md bg-blue-tint px-4 py-3 text-[0.8125rem] leading-[1.5] text-blue-deep">
          {t('account.requestForm.prefilledFrom', { label: prefill.label })}
        </p>
      ) : null}

      <div className="my-6 h-px bg-line sm:my-7" />

      <form action={formAction} className="flex flex-col gap-8">
        <input type="hidden" name="transactionType" value={transactionType} />
        {selectedCommunes.map((name) => (
          <input key={name} type="hidden" name="communes" value={name} />
        ))}
        <input type="hidden" name="bedrooms" value={bedrooms} />

        <Step number={1} title={t('account.requestForm.transactionType')}>
          <div className="grid gap-3.5 sm:grid-cols-2">
            {[
              { value: 'vente', label: t('account.requestForm.buy'), hint: t('account.requestForm.buyHint') },
              { value: 'location', label: t('account.requestForm.rent'), hint: t('account.requestForm.rentHint') },
            ].map(({ value, label, hint }) => {
              const active = transactionType === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTransactionType(value)}
                  aria-pressed={active}
                  className={cn(
                    'flex flex-col items-start gap-1.5 rounded-md px-5 py-4 text-left transition-colors',
                    active
                      ? 'bg-blue-tint shadow-[inset_0_0_0_1.5px_var(--blue)]'
                      : 'bg-surface shadow-[inset_0_0_0_1px_var(--line)] hover:bg-canvas-alt',
                  )}
                >
                  <span className="text-[0.9375rem] font-bold text-ink">{label}</span>
                  <span className="text-[0.8125rem] text-ink-45">{hint}</span>
                </button>
              );
            })}
          </div>
        </Step>

        <Step
          number={2}
          title={t('account.requestForm.targetCommunes')}
          hint={t('account.requestForm.communesHint', { max: MAX_REQUEST_COMMUNES })}
        >
          {communes.length > 0 ? (
            <CommunePicker
              communes={communes}
              popular={popularCommunes}
              selected={selectedCommunes}
              onToggle={toggleCommune}
              atCap={atCommuneCap}
            />
          ) : (
            <p className="text-[0.8125rem] text-ink-45">
              {t('account.requestForm.communesUnavailable')}
            </p>
          )}
        </Step>

        <Step number={3} title={t('account.requestForm.budgetAndBedrooms')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="budgetMin" className="u-eyebrow mb-1.5 block">
                {t('account.requestForm.budgetMin')}
              </label>
              <input
                id="budgetMin"
                name="budgetMin"
                type="number"
                min="0"
                inputMode="numeric"
                placeholder="800"
                defaultValue={prefill?.budgetMin || ''}
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label htmlFor="budgetMax" className="u-eyebrow mb-1.5 block">
                {t('account.requestForm.budgetMax')}
              </label>
              <input
                id="budgetMax"
                name="budgetMax"
                type="number"
                min="0"
                inputMode="numeric"
                placeholder="1500"
                defaultValue={prefill?.budgetMax || ''}
                className={FIELD_CLASS}
              />
            </div>
          </div>

          <div className="mt-5">
            <p className="u-eyebrow mb-2.5">{t('account.requestForm.bedroomCount')}</p>
            <div className="flex w-max max-w-full flex-wrap gap-1 rounded-full bg-canvas-alt p-1">
              {BEDROOM_OPTIONS.map(({ value, label, labelKey }) => {
                const active = bedrooms === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setBedrooms(active ? '' : value)}
                    aria-pressed={active}
                    className={cn(
                      'rounded-full px-4 py-2 text-[0.8125rem] font-semibold transition-colors',
                      active ? 'bg-surface text-blue-deep shadow-sm' : 'text-ink-45 hover:text-ink',
                    )}
                  >
                    {labelKey ? t(labelKey) : label}
                  </button>
                );
              })}
            </div>
          </div>
        </Step>

        <Step number={4} title={t('account.requestForm.moveInDateTitle')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="movingDate" className="u-eyebrow mb-1.5 block">
                {t('account.requestForm.fromDate')}
              </label>
              <input
                id="movingDate"
                name="movingDate"
                type="text"
                placeholder={t('account.requestForm.datePlaceholder')}
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label htmlFor="flexibility" className="u-eyebrow mb-1.5 block">
                {t('account.requestForm.flexibility')}
              </label>
              <select id="flexibility" name="flexibility" defaultValue="" className={FIELD_CLASS}>
                <option value="">{t('account.requestForm.noPreference')}</option>
                {FLEXIBILITY_OPTIONS.map(({ value, labelKey }) => (
                  <option key={value} value={value}>
                    {t(labelKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="notes" className="u-eyebrow mb-1.5 block">
              {t('account.requestForm.notes')}
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              placeholder={t('account.requestForm.notesPlaceholder')}
              className={cn(FIELD_CLASS, 'resize-y leading-[1.55]')}
            />
          </div>
        </Step>

        <div className="h-px bg-line" />

        {/* No success branch: a submitted request redirects to Messages &
            Visites, which confirms it by number and opens on that thread
            (../actions.js). Only a real failure keeps the customer here,
            with everything they typed still in the form. */}
        {state?.status === 'error' ? (
          <p className="flex items-start gap-2.5 rounded-md bg-danger-tint px-4 py-3 text-[0.875rem] font-medium text-danger">
            <CircleAlert strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {state.message}
          </p>
        ) : null}

        {/* Sticky to the bottom of the screen on a phone, so the long form
            never has to be scrolled to its end to find the button. */}
        <div className="sticky bottom-0 z-10 -mx-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-surface/95 px-5 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          <SubmitButton />
          <span className="text-[0.8125rem] text-ink-45">
            {t('account.requestForm.sentWithAccountNumber')}
          </span>
        </div>
      </form>
    </PortalPanel>
  );
}
