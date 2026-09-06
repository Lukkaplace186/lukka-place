'use client';

import { useCallback, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover';
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  SUGGESTED_COUNTRIES,
  findCountry,
  flagEmoji,
  regionName,
  searchKey,
} from '@/lib/countries';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * The one phone input for the whole product: a country picker welded to a
 * national-number field, posting `name` (what the visitor typed) and
 * `<name>Country` (the ISO 3166-1 code they picked) so the Server Action can
 * call `normalizePhone(value, country)` and get a real E.164 number out.
 *
 * It exists because the platform stopped being Kinshasa-only. Before this,
 * every phone field was a bare `<input type="tel">` and lib/phone.js had to
 * *guess* the country: a bare 10-digit string starting with 0 was assumed to
 * be a DRC number, so a London diaspora buyer typing their real 07932 673460
 * was silently stored as +243 793 267 346 — a Kinshasa number belonging to
 * somebody else, and an OTP that could never arrive. Picking the country is
 * the only thing that removes the guess.
 *
 * **Copy comes in as props, not from `useT`.** This renders inside the
 * (portfolio) route group too, which mounts no I18nProvider — a `useT` there
 * would render raw dot-paths on a real public page. Callers that live under
 * a provider pass translated labels; the defaults are French, this app's
 * default locale.
 *
 * No new dependency: the list is lib/countries.js (E.164 dial codes; names
 * resolved from the platform's own ICU data), the panel is the Radix popover
 * already in components/ui.
 */

const STORAGE_KEY = 'lukka_phone_country';


const DEFAULT_LABELS = {
  label: 'Numéro WhatsApp',
  placeholder: 'Votre numéro sans l’indicatif',
  countryLabel: 'Indicatif pays',
  search: 'Rechercher un pays',
  empty: 'Aucun pays trouvé',
};

/** Remembering the last country turns a repeat visit into zero taps. Not a credential — a display preference, same posture as lib/currencyPreference.js. */
function readStoredCountry() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeCountry(iso2) {
  try {
    window.localStorage.setItem(STORAGE_KEY, iso2);
  } catch {
    // Storage disabled/full — the picker still works, it just won't be
    // pre-set next time. Not worth failing a signup over.
  }
  cachedDetected = iso2;
  for (const listener of detectionListeners) listener();
}

/**
 * The region the browser itself reports ('en-GB' -> 'GB'), used only when
 * the visitor has never picked one here and the server's own
 * Accept-Language read (lib/requestCountry.js) is not already right.
 *
 * Only a tag that CARRIES a region counts — `maximize()` is deliberately not
 * used, because it would turn a bare 'fr' into 'fr-Latn-FR' and default a
 * Kinshasa visitor to France on the strength of a language-data likelihood.
 * No region in the tag means no signal, not a weaker one.
 */
function browserRegion() {
  const tags = [];
  if (typeof navigator !== 'undefined') {
    if (Array.isArray(navigator.languages)) tags.push(...navigator.languages);
    if (navigator.language) tags.push(navigator.language);
  }
  for (const tag of tags) {
    try {
      const region = new Intl.Locale(tag).region;
      if (region && findCountry(region)) return region.toUpperCase();
    } catch {
      // Malformed tag from an exotic browser — try the next one.
    }
  }
  return null;
}

/**
 * localStorage and `navigator.languages` are external stores, so the
 * detected country is read through useSyncExternalStore rather than written
 * into state from an effect. That is not ceremony: it is what makes the
 * server render (which knows neither) and the hydrated client render agree
 * without a flash of the wrong dial code, and it is the pattern this repo's
 * lint enforces (react-hooks/set-state-in-effect — the same rule
 * components/OtpResendButton.js documents having been shaped by).
 *
 * The snapshot is memoised at module scope because useSyncExternalStore
 * requires a value that is stable between renders; `storeCountry` above
 * refreshes it and notifies every mounted field, so two PhoneFields on one
 * page stay in sync.
 */
const detectionListeners = new Set();
let cachedDetected;

function subscribeToDetection(listener) {
  detectionListeners.add(listener);
  return () => detectionListeners.delete(listener);
}

function detectedCountrySnapshot() {
  if (cachedDetected === undefined) {
    const stored = readStoredCountry();
    cachedDetected = (stored && findCountry(stored) ? stored.toUpperCase() : null) || browserRegion() || null;
  }
  return cachedDetected;
}

/** The server knows nothing about this browser: it renders the caller's default. */
function serverDetectionSnapshot() {
  return null;
}

export default function PhoneField({
  name = 'phone',
  id,
  defaultCountry = DEFAULT_COUNTRY,
  defaultValue = '',
  labels = {},
  locale = 'fr',
  required = false,
  autoFocus = false,
  autoComplete = 'tel',
  hint = null,
  className,
  labelClassName,
  fieldClassName,
  inputClassName,
  detectCountry = true,
}) {
  const copy = { ...DEFAULT_LABELS, ...labels };
  const reactId = useId();
  const inputId = id || `phone-${reactId}`;
  const listboxId = `phone-list-${reactId}`;

  // Three layers, most specific first: what this visitor just picked, what
  // their browser says about them, and the caller's default.
  const [chosen, setChosen] = useState(null);
  const detected = useSyncExternalStore(subscribeToDetection, detectedCountrySnapshot, serverDetectionSnapshot);
  const fallback = findCountry(defaultCountry) ? defaultCountry.toUpperCase() : DEFAULT_COUNTRY;
  const country = chosen || (detectCountry ? detected : null) || fallback;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const searchRef = useRef(null);
  const listRef = useRef(null);
  const numberRef = useRef(null);

  const options = useMemo(() => {
    const named = COUNTRIES.map((c) => ({
      ...c,
      name: regionName(c.iso2, locale),
      // Matched against the English name too, so a French-locale visitor
      // typing "germany" or "ivory coast" still finds it.
      haystack: `${searchKey(regionName(c.iso2, locale))} ${searchKey(regionName(c.iso2, 'en'))} ${c.iso2.toLowerCase()} ${c.dial}`,
    }));
    named.sort((a, b) => a.name.localeCompare(b.name, locale));

    const suggested = SUGGESTED_COUNTRIES.map((iso2) => named.find((c) => c.iso2 === iso2)).filter(Boolean);
    const rest = named.filter((c) => !SUGGESTED_COUNTRIES.includes(c.iso2));
    return { all: named, ordered: [...suggested, ...rest], suggestedCount: suggested.length };
  }, [locale]);

  const filtered = useMemo(() => {
    const q = searchKey(query).trim();
    if (!q) return options.ordered;
    const terms = q.split(/\s+/);
    // A leading '+' is how people search a dial code; searchKey has already
    // dropped it, so a numeric query matches the dial column naturally.
    return options.all.filter((c) => terms.every((term) => c.haystack.includes(term)));
  }, [options, query]);

  const selected = findCountry(country) || findCountry(DEFAULT_COUNTRY);

  const choose = useCallback((iso2) => {
    setChosen(iso2);
    storeCountry(iso2);
    setOpen(false);
    setQuery('');
    // Straight back to typing the number — the picker is a detour, not the
    // destination. Moved synchronously rather than left to the popover's
    // close handler because the panel animates out: for those ~100ms the
    // search box is still mounted and still focused, and keystrokes meant
    // for the number land in it (confirmed in the preview — picking Belgium
    // and typing immediately put the digits in the search box).
    numberRef.current?.focus();
  }, []);

  function moveActive(delta) {
    if (filtered.length === 0) return;
    setActiveIndex((current) => {
      const next = Math.min(Math.max(current + delta, 0), filtered.length - 1);
      listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' });
      return next;
    });
  }

  function handleSearchKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(filtered.length - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const match = filtered[activeIndex];
      if (match) choose(match.iso2);
    }
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <label
        htmlFor={inputId}
        className={cn('mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45', labelClassName)}
      >
        {copy.label}
      </label>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          {/* One field to the eye, two controls to the keyboard: the ring is
              drawn on the wrapper via focus-within so tabbing between the
              country button and the number never looks like leaving the field. */}
          <div
            className={cn(
              'flex items-stretch rounded-md border border-line bg-white transition-colors focus-within:border-ink-25 focus-within:ring-2 focus-within:ring-ink/10',
              fieldClassName,
            )}
          >
            <button
              type="button"
              role="combobox"
              aria-expanded={open}
              aria-controls={open ? listboxId : undefined}
              aria-label={`${copy.countryLabel} : ${regionName(selected.iso2, locale)} +${selected.dial}`}
              onClick={() => setOpen((v) => !v)}
              className="flex shrink-0 items-center gap-1.5 rounded-l-md px-2.5 py-2 text-sm text-ink transition-colors hover:bg-canvas focus:outline-none"
            >
              <span aria-hidden className="text-[0.9375rem] leading-none">
                {flagEmoji(selected.iso2)}
              </span>
              <span className="u-tabular text-sm font-semibold">+{selected.dial}</span>
              <ChevronDown strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 opacity-45" />
            </button>

            <span aria-hidden className="my-1.5 w-px shrink-0 bg-line" />

            <input
              ref={numberRef}
              id={inputId}
              name={name}
              type="tel"
              inputMode="tel"
              autoComplete={autoComplete}
              autoFocus={autoFocus}
              required={required}
              defaultValue={defaultValue}
              placeholder={copy.placeholder}
              className={cn(
                'u-tabular min-w-0 flex-1 rounded-r-md bg-transparent px-3 py-2 text-sm text-ink placeholder:text-ink-45/70 focus:outline-none',
                inputClassName,
              )}
            />
          </div>
        </PopoverAnchor>

        {/* The country actually submitted. Kept beside the number rather than
            encoded into it on the client: the Server Action re-normalizes
            from these two raw values, so a hand-crafted POST gets the same
            treatment a real form does. */}
        <input type="hidden" name={`${name}Country`} value={selected.iso2} readOnly />

        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[min(22rem,calc(100vw-1.5rem))] gap-0 p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            // Radix's default is to restore focus to the trigger. Two
            // reasons not to let it: the visitor's next act is always typing
            // the number, not re-opening the list; and choosing with Enter
            // put focus back on the trigger button just in time for that
            // same keystroke's keyup to "click" it and reopen the panel —
            // which is exactly what it did before this handler existed.
            event.preventDefault();
            numberRef.current?.focus();
          }}
        >
          <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
            <Search strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-45" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                // Reset here, not in an effect on `query`: the highlight
                // belongs to the list the visitor is looking at, and the
                // keystroke is the moment that list changes.
                setActiveIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder={copy.search}
              aria-label={copy.search}
              aria-controls={listboxId}
              aria-activedescendant={filtered[activeIndex] ? `${listboxId}-${filtered[activeIndex].iso2}` : undefined}
              className="w-full bg-transparent text-sm text-ink placeholder:text-ink-45/70 focus:outline-none"
            />
          </div>

          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={copy.countryLabel}
            className="max-h-[16rem] overflow-y-auto overscroll-contain py-1"
          >
            {filtered.length === 0 && <p className="px-3 py-6 text-center text-sm text-ink-45">{copy.empty}</p>}

            {filtered.map((option, index) => {
              const isSelected = option.iso2 === selected.iso2;
              // Only in the unfiltered view, where the pinned block is a real
              // ordering the visitor can see; in search results a divider
              // would be meaningless.
              const startsRest = !query && index === options.suggestedCount && options.suggestedCount > 0;
              return (
                <div key={option.iso2}>
                  {startsRest && <div aria-hidden className="my-1 border-t border-line" />}
                  <button
                    type="button"
                    id={`${listboxId}-${option.iso2}`}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(option.iso2)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
                      index === activeIndex ? 'bg-canvas' : 'bg-transparent',
                    )}
                  >
                    <span aria-hidden className="w-5 shrink-0 text-[0.9375rem] leading-none">
                      {flagEmoji(option.iso2)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ink">{option.name}</span>
                    <span className="u-tabular shrink-0 text-ink-45">+{option.dial}</span>
                    {isSelected && (
                      <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-blue" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {hint && <p className="mt-1 text-xs text-ink-45">{hint}</p>}
    </div>
  );
}
