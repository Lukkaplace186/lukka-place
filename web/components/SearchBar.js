'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import LocationAutocomplete from './LocationAutocomplete';

/**
 * Hero search.
 *
 * Location entry is LocationAutocomplete (see that file) — real communes,
 * quartiers and landmarks from lib/gazetteer.js, with real approved-listing
 * counts on commune suggestions. This replaces the previous split of a
 * `<select>` sourced from getCommuneShowcase() plus a separate free-text
 * field; the autocomplete's own API route sources its defaults from
 * lib/listings.js's getPopularCommunes() directly, so nothing here needs to
 * fetch or thread commune data through anymore.
 *
 * Picking a suggestion navigates straight to `/listings` with the right
 * commune/quartier/q param — see LocationAutocomplete's `extraParams`,
 * which carries the transaction-type toggle along so it survives that
 * navigation instead of getting silently dropped.
 *
 * "Classique" / "Recherche IA" is a UI mode, not two different backends —
 * both submit through the same LocationAutocomplete -> parseSearchQuery()
 * -> /listings pipeline (lib/searchParser.js), same as Rightmove's own AI
 * Search still lands on its normal results page. AI mode only swaps the
 * placeholder/suggestions for ones that invite a full sentence instead of a
 * place name; it does not add a filter Classic mode lacks — there is no
 * radius/distance search (properties have no real stored coordinates; see
 * the note in the root CLAUDE.md's "Interactive Property Map" section), so
 * placeholder/suggestion copy here deliberately says "près de X" (a real
 * commune-level landmark match — see lib/gazetteer.js's findLocationMention,
 * used by searchParser.js) rather than implying a km-precise radius nothing
 * backs. Suggestion copy is otherwise honest about what the parser does:
 * "avec piscine"/"meublé" work because they ride the real description
 * search (lib/listings.js's ILIKE fallback), not a `has_pool` column.
 *
 * Classic mode's placeholder deliberately still reads "Commune, quartier,
 * référence…" (not the "point de repère" wording from a later design pass)
 * for two reasons: the root CLAUDE.md is explicit — "Always use the French
 * term 'référence' (not 'repère')" — and FilterBar.js's own instance of
 * this exact field uses the same copy; diverging here would make the same
 * control read as two different things depending which page it's on.
 */
const TRANSACTIONS = [
  { value: 'location', label: 'Louer' },
  { value: 'vente', label: 'Acheter' },
];

const SEARCH_MODES = [
  { value: 'classic', label: '🔍 Classique' },
  { value: 'ai', label: '✨ Recherche IA' },
];

// Short, one-tap-friendly on purpose (mobile discovery) — every one still
// real and verified live against the actual parser (lib/searchParser.js)
// and gazetteer (lib/data/kinshasa-gazetteer.json). "Groupe" stays a
// free-text keyword (see the note at the top of searchParser.js) — it rides
// the real ILIKE description fallback rather than a `has_generator` column
// that doesn't exist yet. "Ma Campagne" (a quartier of Ngaliema, not a
// commune) resolves via lib/gazetteer.js's findLocationMention exactly like
// a landmark does.
const AI_SUGGESTIONS = ['Gombe 2 chambres', 'Studio meublé', 'Ma Campagne', 'avec groupe'];

export default function SearchBar() {
  const [transaction, setTransaction] = useState('location');
  const [mode, setMode] = useState('classic');
  const isAi = mode === 'ai';

  return (
    // The search "card" — one frosted container holding both rows, sitting
    // on the photograph. Dark/translucent rather than the light bg-white/90
    // a white-background page would use: every other element in this hero
    // (eyebrow, headline, lead) is white text over Hero.js's dark photo
    // scrim, and a light card here would fight that, not extend it.
    <div className="w-full max-w-2xl rounded-2xl border border-white/15 bg-ink/30 p-4 backdrop-blur-md u-lift-lg sm:p-5">
      {/* Row 1: transaction toggle top-left, search-mode toggle top-right.
          flex-wrap lets the mode toggle drop to its own line on narrow
          viewports instead of squeezing both pill groups into
          stacked-then-clipped chaos — verified at a 375px viewport. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        {/* Segmented transaction toggle — the reference portals put this
            choice first because it changes the meaning of every price
            below it. */}
        <div className="inline-flex rounded-full border border-white/25 bg-white/10 p-1">
          {TRANSACTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTransaction(value)}
              aria-pressed={transaction === value}
              className={`inline-flex h-10 items-center justify-center rounded-full px-5 text-[0.8125rem] font-semibold transition-colors ${
                transaction === value ? 'bg-surface text-ink' : 'text-white/80 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Classique / Recherche IA — same submission pipeline underneath
            (see the doc comment above), just a different placeholder and
            suggestion set. Active pill: brand blue fill, not the light fill
            the transaction toggle uses above — this is the one high-intent
            choice on the card, styled to read as *the* primary switch. */}
        <div className="inline-flex rounded-full border border-white/25 bg-white/10 p-1">
          {SEARCH_MODES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={`inline-flex h-10 items-center justify-center rounded-full px-4 text-[0.8125rem] font-semibold transition-colors ${
                mode === value ? 'bg-blue text-white' : 'text-white/80 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: the input itself — classic dropdown or AI free-text,
          depending on mode. */}
      {isAi ? <p className="mb-2 text-[0.8125rem] font-semibold text-white">Partagez ce qui compte pour vous</p> : null}

      <label className="sr-only" htmlFor="hero-location">
        {isAi ? 'Partagez ce qui compte pour vous' : 'Commune, quartier ou référence'}
      </label>
      <LocationAutocomplete
        // Remounts the field when the mode changes so stray typed text from
        // one mode doesn't linger into the other's very different
        // placeholder/suggestion context. The transaction toggle above is
        // separate state on this component and is untouched by this
        // remount, so it (the one real filter that can exist before a
        // visitor has submitted anything from this homepage box) survives
        // a mode switch.
        key={mode}
        id="hero-location"
        variant="hero"
        placeholder={isAi ? 'Ex: 2 chambres sous 800$ près de St Luc' : 'Commune, quartier, référence…'}
        extraParams={{ transaction_type: transaction }}
        showButton
        buttonLabel={isAi ? '✨ Rechercher' : 'Rechercher'}
        showIcon={isAi}
        icon={Sparkles}
        hideDropdown={isAi}
        suggestions={isAi ? AI_SUGGESTIONS : []}
        className="rounded-xl bg-surface p-2 u-lift-lg sm:rounded-full"
        rowClassName="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-0"
        inputClassName="bg-transparent px-4 py-3 text-sm font-medium text-ink placeholder:text-ink-25 focus:outline-none"
      />
    </div>
  );
}
