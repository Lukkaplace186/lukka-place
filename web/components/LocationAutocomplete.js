'use client';

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { MapPin, Landmark, Search, Sparkles, X, Clock, BedDouble, Bath, Home, DollarSign, Hash } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { parseSearchQuery, escapeRegExp } from '@/lib/searchParser';

const PROPERTY_TYPE_LABELS = {
  appartement: 'Appartement',
  maison: 'Maison',
  parcelle: 'Parcelle',
};

/**
 * Turns a parseSearchQuery() result into the ordered list of live-preview
 * pills — one source of truth for both what's shown and what a pill's ×
 * button removes (`field`, matched against `parsed.spans`).
 */
function buildPreviewPills(parsed) {
  if (!parsed) return [];
  const pills = [];

  if (parsed.reference) {
    pills.push({ field: 'reference', icon: Hash, label: `Réf ${parsed.reference}` });
  }
  if (parsed.commune) {
    const place = parsed.quartier ? `${parsed.quartier} (${parsed.commune})` : parsed.commune;
    pills.push({ field: 'commune', icon: MapPin, label: place });
  }
  if (parsed.beds_min != null) {
    pills.push({ field: 'beds_min', icon: BedDouble, label: `${parsed.beds_min}+ Chambres` });
  }
  if (parsed.bath_min != null) {
    pills.push({ field: 'bath_min', icon: Bath, label: `${parsed.bath_min}+ SDB` });
  }
  if (parsed.property_type) {
    const typeLabel = PROPERTY_TYPE_LABELS[parsed.property_type] || parsed.property_type;
    const subtypeLabel = parsed.parcelle_subtype === 'villa' ? ' (Villa)' : parsed.parcelle_subtype === 'terrain_nu' ? ' (Terrain)' : '';
    pills.push({ field: 'property_type', icon: Home, label: `${typeLabel}${subtypeLabel}` });
  }
  if (parsed.price_min != null || parsed.price_max != null) {
    const label =
      parsed.price_min != null && parsed.price_max != null
        ? `${parsed.price_min}$ - ${parsed.price_max}$`
        : parsed.price_max != null
          ? `Max ${parsed.price_max}$`
          : `Dès ${parsed.price_min}$`;
    // Both price_min and price_max share one "Prix" pill/× action (removing
    // whichever span(s) are actually present) since they render as a single
    // combined label — two separate pills for one price phrase would be a
    // confusing UI, and searchParser.js only ever fills one of the two from
    // a single price phrase in practice anyway.
    pills.push({ field: 'price', icon: DollarSign, label, spanFields: ['price_min', 'price_max'] });
  }

  return pills;
}

/** Merges every structured filter parseSearchQuery() found — except location,
 *  which each caller (submitFreeText, navigateTo) resolves its own way —
 *  into `params`. Shared so a suggestion click no longer discards beds/
 *  price/type/reference that the identical text already parses correctly
 *  through submitFreeText(): confirmed live, typing "2 chambres kasavubu
 *  moins de 1000" and clicking the "Kasa-Vubu" suggestion used to produce
 *  `?commune=Kasa-Vubu` alone, silently dropping the other two. */
function applyParsedFilters(params, parsed) {
  if (parsed.reference) params.set('reference', parsed.reference);
  if (parsed.transaction_type) params.set('transaction_type', parsed.transaction_type);
  if (parsed.price_min != null) params.set('price_min', String(parsed.price_min));
  if (parsed.price_max != null) params.set('price_max', String(parsed.price_max));
  if (parsed.beds_min != null) params.set('beds_min', String(parsed.beds_min));
  if (parsed.bath_min != null) params.set('bath_min', String(parsed.bath_min));
  if (parsed.property_type) {
    params.set('property_type', parsed.property_type);
    if (parsed.parcelle_subtype) params.set('parcelle_subtype', parsed.parcelle_subtype);
    else params.delete('parcelle_subtype');
  }
}

const DEBOUNCE_MS = 150;
// Below this much room, flip the panel above the input instead of letting
// it get clipped against the viewport edge — see updatePosition().
const MIN_SPACE_FOR_BELOW = 200;

// AI-mode search history, local to this browser only — no server-side
// "search history" feature exists (there's no accounts-backed search log),
// same honesty principle as lib/localFavorites.js's localStorage-only
// favorites. Read/written directly rather than through a hook: it's two
// small helpers used from exactly one place (submitFreeText below).
const SEARCH_HISTORY_KEY = 'lukka_search_history';
const SEARCH_HISTORY_MAX = 3;

function readSearchHistory() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SEARCH_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function pushSearchHistory(text) {
  if (typeof window === 'undefined' || !text || !text.trim()) return readSearchHistory();
  const trimmed = text.trim();
  const next = [trimmed, ...readSearchHistory().filter((v) => v.toLowerCase() !== trimmed.toLowerCase())].slice(
    0,
    SEARCH_HISTORY_MAX,
  );
  try {
    window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Storage full/disabled — history just doesn't persist this time, not
    // worth failing the actual search over.
  }
  return next;
}

function stripDiacritics(value) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function normalize(value) {
  return stripDiacritics(String(value || '')).toLowerCase();
}

/** Bold the part of `label` that matches `query`, accent/case-insensitive.
 *  Results are guaranteed by the API to contain the query as a substring
 *  (see lib/gazetteer.js), so this only has to find where — not whether. */
function HighlightedLabel({ label, query }) {
  if (!query) return label;
  const normLabel = normalize(label);
  const normQuery = normalize(query);
  const start = normLabel.indexOf(normQuery);
  if (start === -1) return label;
  const end = start + normQuery.length;
  return (
    <>
      {label.slice(0, start)}
      <strong className="font-semibold text-ink">{label.slice(start, end)}</strong>
      {label.slice(end)}
    </>
  );
}

const TYPE_ICON = { commune: MapPin, quartier: MapPin, landmark: Landmark };
const TYPE_LABEL_FR = { commune: 'Commune', quartier: 'Quartier', landmark: 'Référence' };

/**
 * `useSearchParams()` forces Next to require a Suspense boundary around its
 * caller when the page it's on is statically prerendered — the same class
 * of bug this app already hit once in /favoris. Hero/SearchBar renders on
 * `/`, which *is* statically prerendered, and doesn't even need current URL
 * params (it always builds a fresh URL from `extraParams`); FilterBar
 * renders on the already-dynamic /listings route and does need them. Rather
 * than call the hook unconditionally and force a Suspense wrapper onto the
 * homepage for a value the hero never reads, the hook lives in this small
 * wrapper, which is only ever mounted when `preserveParams` is true.
 */
function SearchParamsBridge({ children }) {
  const searchParams = useSearchParams();
  return children(searchParams);
}

/**
 * Zillow-style location autocomplete — real communes, quartiers and
 * landmarks from lib/gazetteer.js, with real approved-listing counts on
 * commune suggestions (from /api/locations/autocomplete, which reads
 * lib/listings.js's getPopularCommunes()).
 *
 * Hand-rolled rather than a Radix primitive on purpose: Radix has no
 * combobox/autocomplete component (Popover is for a static panel, not one
 * that owns keyboard-navigable listbox semantics tied to a text input), so
 * this implements the real ARIA combobox pattern by hand — the one
 * documented exception to "use Radix for anything interactive" (see
 * web/CLAUDE.md).
 *
 * The results panel is rendered through a portal into `document.body` with
 * `position: fixed`, not as a plain `absolute` child. It has to be: the
 * hero instance sits inside Hero.js's `<section overflow-hidden>` (needed
 * for the ken-burns photo effect), and an `overflow-hidden` ancestor clips
 * an absolutely-positioned descendant at its own box edge regardless of
 * that descendant's own `overflow-y-auto` — confirmed directly against a
 * real screenshot, where the panel cut off mid-row well short of its own
 * max-height. Portaling to `document.body` is the standard fix (it's what
 * Radix's own Popover does internally) and also sidesteps any stacking-
 * context/z-index surprises from nested `relative` ancestors.
 *
 * Selecting a suggestion navigates directly to `/listings`, matching what
 * was asked for. Two navigation modes:
 *   - `preserveParams` (FilterBar, already on /listings): merges into the
 *     *current* URL's params, so price/beds/type/sort filters survive a new
 *     location pick — only commune/quartier/q/page are touched.
 *   - default (Hero, on `/`): builds a fresh URL from `extraParams` only
 *     (e.g. the transaction-type toggle) — there is no prior /listings
 *     search to preserve.
 *
 * `ref` exposes two imperative methods:
 *   - `submit()` — the same free-text submit `showButton`'s own internal
 *     button calls. Only needed when a caller renders its OWN "Rechercher"
 *     button outside this component (SearchBar.js's hero: the button is a
 *     full-width CTA below the field block, so it can't live glued to the
 *     input the way `showButton` renders it) — pass `showButton={false}`
 *     in that case.
 *   - `setQuery(text)` — fills the field from outside (SearchBar.js's
 *     commune quick pills).
 * Every other caller ignores both.
 */
const LocationAutocomplete = forwardRef(function LocationAutocomplete(props, ref) {
  return props.preserveParams ? (
    <SearchParamsBridge>{(searchParams) => <LocationAutocompleteCore {...props} currentParams={searchParams} ref={ref} />}</SearchParamsBridge>
  ) : (
    <LocationAutocompleteCore {...props} currentParams={null} ref={ref} />
  );
});

export default LocationAutocomplete;

const LocationAutocompleteCore = forwardRef(function LocationAutocompleteCore({
  id,
  name = 'q',
  ariaLabel,
  placeholder = 'Commune, quartier, référence…',
  initialValue = '',
  extraParams = {},
  preserveParams = false,
  currentParams,
  variant = 'pill',
  showIcon = false,
  icon: InputIcon = Search,
  showClear = false,
  showButton = false,
  buttonLabel = 'Rechercher',
  className = '',
  rowClassName = 'flex items-center gap-2',
  inputClassName = '',
  // Reports the current text back to the caller on every change — typed or
  // set through the `setQuery` imperative method below. SearchBar.js's hero
  // uses it to keep its commune quick-pills honest: a pill is only tinted
  // active while the field still literally holds that commune's name, so
  // typing over it un-tints the pill rather than leaving a lit chip
  // claiming a filter the field no longer carries. Every other caller
  // ignores it — the component still owns `value` itself, this is a
  // notification, not a controlled-input handoff.
  onValueChange,
  // "AI Search" mode (SearchBar.js): swaps the real gazetteer dropdown for a
  // static list of example queries. hideDropdown stops the debounced
  // /api/locations/autocomplete fetch entirely — there's no structured
  // suggestion to show once free text is the whole point of the mode.
  hideDropdown = false,
  suggestions = [],
  // Classic mode only (FilterBar.js) — {label, href} entries from
  // lib/searchHistory.js, shown above the normal place-suggestion list
  // while the box is focused and still empty. A distinct, structured-filter
  // history from AI mode's own raw-sentence `history` state below; the two
  // never mix.
  recentSearches = [],
}, ref) {
  const router = useRouter();
  const listboxId = useId();
  const reactId = useId();

  const [value, setValue] = useState(initialValue);
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState(null);
  // Starts empty (not read synchronously) so server and first client render
  // match — localStorage doesn't exist server-side, same pattern
  // FavoriteButton.js/CurrencyToggle.js already use for this exact reason.
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (hideDropdown) setHistory(readSearchHistory());
  }, [hideDropdown]);

  // Live "as-you-type" intent preview (AI mode only) — the same real
  // parseSearchQuery() the actual submit uses, just run continuously on a
  // debounce rather than once on Enter, so a visitor sees what's being
  // understood before committing to it.
  const [livePreview, setLivePreview] = useState(null);

  useEffect(() => {
    if (!hideDropdown) return undefined;
    if (!value.trim()) {
      setLivePreview(null);
      return undefined;
    }
    const timer = setTimeout(() => setLivePreview(parseSearchQuery(value)), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, hideDropdown]);

  function removePreviewField(pill) {
    const fields = pill.spanFields || [pill.field];
    let next = value;
    for (const field of fields) {
      const span = livePreview?.spans?.[field];
      if (!span) continue;
      next = next.replace(new RegExp(escapeRegExp(span), 'i'), ' ');
    }
    next = next.replace(/\s+/g, ' ').trim();
    setValue(next);
    setLivePreview(next ? parseSearchQuery(next) : null);
  }

  const containerRef = useRef(null);
  const listboxRef = useRef(null);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);

  const fetchResults = useCallback((query) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    fetch(`/api/locations/autocomplete?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => {
        setResults(json.results || []);
        setActiveIndex(-1);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setResults([]);
      });
  }, []);

  useEffect(() => {
    if (!open || hideDropdown) return undefined;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchResults(value), DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [value, open, hideDropdown, fetchResults]);

  // Recompute the portal's fixed position whenever the panel is open, and
  // keep it pinned to the input on scroll (capture: true so it catches
  // scrolling on *any* ancestor, not just the window) and resize. Flips
  // above the input when there isn't enough room below — the mobile case
  // this was explicitly asked to handle, where the input often sits low
  // enough in the viewport that "below" would run off the bottom edge.
  useEffect(() => {
    if (!open) return undefined;

    function updatePosition() {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const gap = 8;
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;

      // The panel's *intended* height (matches the max-h-[300px]/
      // sm:max-h-[400px] classes below) — not an arbitrary constant. Flip
      // above only when that side genuinely has more room to offer; either
      // way, cap the panel to whatever room actually exists so it can never
      // extend past the viewport edge regardless of which side wins. This
      // is what MIN_SPACE_FOR_BELOW alone got wrong: a flat 200px threshold
      // judged "enough room below" without checking against the panel's
      // real height, so an 8-result list (~346px) still ran ~140px past the
      // viewport bottom even though it had technically cleared the
      // threshold — confirmed by measuring the live rect, not assumed.
      const desiredMaxHeight = window.innerWidth < 640 ? 300 : 400;
      const placeAbove = spaceBelow < Math.min(desiredMaxHeight, MIN_SPACE_FOR_BELOW) && spaceAbove > spaceBelow;
      const available = placeAbove ? spaceAbove : spaceBelow;

      setPosition({
        left: rect.left,
        width: rect.width,
        placement: placeAbove ? 'above' : 'below',
        top: placeAbove ? undefined : rect.bottom + gap,
        bottom: placeAbove ? window.innerHeight - rect.top + gap : undefined,
        maxHeight: Math.max(Math.min(desiredMaxHeight, available), 120),
      });
    }

    updatePosition();
    window.addEventListener('scroll', updatePosition, { capture: true, passive: true });
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, { capture: true });
      window.removeEventListener('resize', updatePosition);
    };
  }, [open]);

  useEffect(() => {
    function onPointerDown(e) {
      const insideInput = containerRef.current && containerRef.current.contains(e.target);
      const insideListbox = listboxRef.current && listboxRef.current.contains(e.target);
      if (!insideInput && !insideListbox) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  function buildParams() {
    const params = preserveParams && currentParams ? new URLSearchParams(currentParams.toString()) : new URLSearchParams();
    if (!preserveParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        if (v) params.set(k, v);
      }
    }
    params.delete('page');
    return params;
  }

  function navigateTo(result) {
    const params = buildParams();
    params.delete('quartier');
    params.delete('q');

    // The rest of what was typed can carry real structured filters too
    // (beds/price/type/reference) — clicking a place suggestion previously
    // discarded all of that, keeping only the clicked location. Location
    // itself still comes from `result` (the more authoritative signal — a
    // fuzzy-corrected pick, say) rather than parseSearchQuery's own guess.
    const parsed = parseSearchQuery(value);
    applyParsedFilters(params, parsed);

    if (result.commune) params.set('commune', result.commune);
    if (result.type === 'quartier') params.set('quartier', result.label);
    if (result.type === 'landmark') params.set('q', result.label);
    else if (parsed.keywords) params.set('q', parsed.keywords);

    setOpen(false);
    router.push(`/listings?${params.toString()}`);
  }

  // `overrideText`: a suggestion chip (AI mode) submits its own text
  // directly rather than the input's current (possibly stale) state value —
  // setValue() is async, so reading `value` right after calling it would
  // still see the old string.
  function submitFreeText(overrideText) {
    const text = overrideText != null ? overrideText : value;
    const params = buildParams();

    // AI-mode natural-language searches only — classic mode's free text is
    // "Enter to search «X»" fallback for an unmatched place name, not the
    // kind of sentence "recent searches" is meant to help someone repeat.
    if (hideDropdown && typeof text === 'string' && text.trim()) {
      setHistory(pushSearchHistory(text));
    }

    // "2 chambres à louer sous 800$" -> real price_max/beds_min/transaction_
    // type filters, not a doomed literal-substring search for the whole
    // sentence. Only sets the params this text actually mentioned — an
    // unrelated pill the visitor already picked (e.g. commune) is left
    // alone; whatever wasn't recognized as a structured filter (like
    // "meublé") stays in `q` and still reaches the real description search.
    const parsed = parseSearchQuery(text);
    applyParsedFilters(params, parsed);
    if (parsed.commune) {
      params.set('commune', parsed.commune);
      if (parsed.quartier) params.set('quartier', parsed.quartier);
      else params.delete('quartier');
    }

    if (parsed.keywords) {
      params.set('q', parsed.keywords);
    } else {
      params.delete('q');
    }
    setOpen(false);
    router.push(`/listings?${params.toString()}`);
  }

  // No deps array: submitFreeText is a plain function redeclared every
  // render (not memoized), so this intentionally re-runs every render to
  // always close over the current one rather than risk a stale value/
  // extraParams capture.
  // `setQuery` fills the field from outside (SearchBar.js's commune quick
  // pills). It goes through the same `onValueChange` the keyboard path does
  // so a caller tracking the text sees one consistent signal either way,
  // and it deliberately does NOT open the suggestion panel: a pill tap is
  // already a completed choice, not the start of typing.
  useImperativeHandle(ref, () => ({
    submit: () => submitFreeText(),
    setQuery: (text) => {
      setValue(text);
      onValueChange?.(text);
    },
  }));

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((i) => (results.length === 0 ? -1 : (i + 1) % results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return;
      setActiveIndex((i) => (results.length === 0 ? -1 : (i - 1 + results.length) % results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && activeIndex >= 0 && results[activeIndex]) {
        navigateTo(results[activeIndex]);
      } else {
        submitFreeText();
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  }

  const activeOptionId = activeIndex >= 0 ? `${reactId}-option-${activeIndex}` : undefined;
  const showEmpty = !hideDropdown && open && value.trim() && results.length === 0;
  const showSuggestions = hideDropdown && open && suggestions.length > 0;
  const showRecentSearches = !hideDropdown && open && !value.trim() && recentSearches.length > 0;
  const showPanel =
    Boolean(position) && (hideDropdown ? showSuggestions : open && (results.length > 0 || showEmpty || showRecentSearches));
  const previewPills = hideDropdown ? buildPreviewPills(livePreview) : [];

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className={rowClassName}>
        {showIcon ? <InputIcon strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-25" /> : null}

        <input
          id={id}
          type="text"
          name={preserveParams ? undefined : name}
          aria-label={ariaLabel}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            onValueChange?.(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className={cn('min-w-0 flex-1', inputClassName)}
        />

        {showClear && value ? (
          <button
            type="button"
            onClick={() => {
              setValue('');
              setResults([]);
            }}
            aria-label="Effacer la recherche"
            className="shrink-0 rounded-full p-0.5 text-ink-25 transition-colors hover:bg-canvas-deep hover:text-ink"
          >
            <X strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
          </button>
        ) : null}

        {showButton ? (
          <button
            type="button"
            // NOT onClick={submitFreeText} — that hands the click's
            // SyntheticEvent to submitFreeText's first parameter
            // (`overrideText`, added for the suggestion-chip case below),
            // which then got String()'d into the literal text "[object
            // Object]" and submitted as `q`. Reproduced and confirmed as
            // the exact cause of the "[object Object]" search results bug.
            onClick={() => submitFreeText()}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-blue px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary sm:rounded-full"
          >
            <Search strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {buttonLabel}
          </button>
        ) : null}
      </div>

      {previewPills.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-live="polite">
          {previewPills.map((pill) => (
            <span
              key={pill.field}
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-tint py-1 pl-3 pr-1.5 text-[0.75rem] font-medium text-blue-deep"
            >
              <pill.icon strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 shrink-0" />
              {pill.label}
              <button
                type="button"
                onClick={() => removePreviewField(pill)}
                aria-label={`Retirer le filtre ${pill.label}`}
                className="rounded-full p-0.5 text-blue-deep/70 transition-colors hover:bg-blue/15 hover:text-blue-deep"
              >
                <X strokeWidth={ICON_STROKE_WIDTH} className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {/* One area can be filtered on at a time today (getListings() takes a
          single `commune`) — this says so honestly instead of quietly
          keeping only the first place mentioned and dropping the second
          without a trace, which is what happened before this existed. */}
      {hideDropdown && livePreview?.secondaryLocation ? (
        <p className="mt-1.5 text-[0.75rem] text-ink-45" aria-live="polite">
          « {livePreview.secondaryLocation.label} » a aussi été repéré — la recherche sur plusieurs zones à la fois
          n&apos;est pas encore possible. Essayez-la séparément pour l&apos;instant.
        </p>
      ) : null}

      {showPanel
        ? createPortal(
            <div
              ref={listboxRef}
              id={listboxId}
              role="listbox"
              aria-label="Suggestions de lieux"
              style={{
                position: 'fixed',
                left: position.left,
                width: position.width,
                top: position.top,
                bottom: position.bottom,
                // Wins over the max-h-[...] classes below (inline style
                // always beats a class of any specificity) — this is the
                // dynamic per-viewport cap computed in updatePosition(),
                // the actual fix for the panel running past the viewport
                // edge. The classes stay on as the intended base size for
                // browsers with JS disabled/before the first effect run.
                maxHeight: position.maxHeight,
              }}
              className={cn(
                // Requested sizing: ~300px on mobile (<640px), ~400px
                // (~8 rows) from sm: up — the starting point maxHeight
                // above dynamically tightens per available space.
                // overflow-y-auto is what actually handles a longer result
                // list now that the panel can no longer be clipped by an
                // ancestor's overflow-hidden.
                'z-[100] max-h-[300px] overflow-y-auto rounded-lg border border-line bg-surface py-2 u-lift sm:max-h-[400px]',
                variant === 'hero' ? 'text-ink' : '',
              )}
            >
              {showSuggestions ? (
                <>
                  {history.length > 0 ? (
                    <>
                      <p className="u-eyebrow px-4 pb-1.5 pt-1 !normal-case !tracking-normal text-ink-25">
                        Recherches récentes
                      </p>
                      {history.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => submitFreeText(item)}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[0.875rem] text-ink-70 transition-colors hover:bg-canvas-alt"
                        >
                          <Clock strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-45" />
                          <span className="min-w-0 flex-1 truncate">{item}</span>
                        </button>
                      ))}
                    </>
                  ) : null}
                  <p className="u-eyebrow px-4 pb-1.5 pt-1 !normal-case !tracking-normal text-ink-25">Exemples</p>
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => submitFreeText(suggestion)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[0.875rem] text-ink-70 transition-colors hover:bg-canvas-alt"
                    >
                      <Sparkles strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-45" />
                      <span className="min-w-0 flex-1 truncate">{suggestion}</span>
                    </button>
                  ))}
                </>
              ) : showEmpty ? (
                <p className="px-4 py-3 text-[0.8125rem] text-ink-45">
                  Aucun lieu ne correspond — Entrée pour rechercher &laquo;&nbsp;{value}&nbsp;&raquo;.
                </p>
              ) : (
                <>
                  {showRecentSearches ? (
                    <>
                      <p className="u-eyebrow px-4 pb-1.5 pt-1 !normal-case !tracking-normal text-ink-25">
                        Recherches récentes
                      </p>
                      {recentSearches.map((entry) => (
                        <button
                          key={entry.href}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setOpen(false);
                            router.push(entry.href);
                          }}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[0.875rem] text-ink-70 transition-colors hover:bg-canvas-alt"
                        >
                          <Clock strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-45" />
                          <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                        </button>
                      ))}
                    </>
                  ) : null}
                  {results.map((result, i) => {
                    const Icon = TYPE_ICON[result.type] || MapPin;
                    const active = i === activeIndex;
                    return (
                      <button
                        key={`${result.type}-${result.commune}-${result.label}`}
                        id={`${reactId}-option-${i}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActiveIndex(i)}
                        onClick={() => navigateTo(result)}
                        className={cn(
                          'flex w-full items-center gap-3 px-4 py-2.5 text-left text-[0.875rem] transition-colors',
                          active ? 'bg-blue-tint text-blue-deep' : 'text-ink-70 hover:bg-canvas-alt',
                        )}
                      >
                        <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-45" />
                        <span className="min-w-0 flex-1 truncate">
                          <HighlightedLabel label={result.label} query={value} />
                          {result.type !== 'commune' ? <span className="ml-1.5 text-ink-45">— {result.commune}</span> : null}
                        </span>
                        {result.type === 'commune' && result.count != null ? (
                          <span className="u-tabular shrink-0 text-xs text-ink-45">{result.count}</span>
                        ) : (
                          <span className="u-eyebrow shrink-0 !normal-case !tracking-normal text-ink-25">
                            {TYPE_LABEL_FR[result.type]}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});
