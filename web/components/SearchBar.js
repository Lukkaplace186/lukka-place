'use client';

import { useState } from 'react';
import { Sparkles, ArrowUpRight } from 'lucide-react';
import LocationAutocomplete from './LocationAutocomplete';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

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
 *
 * Panel treatment matches web/Design's own hero search unit: a white card
 * floating over the hero photograph (radius-panel + shadow-panel, not a
 * dark frosted-glass card) with a WhatsApp cross-sell strip in royal-700
 * along its bottom edge ("Vous avez un bien à louer ou à vendre ?" ->
 * "Publier par WhatsApp"), reusing the same central-number helper and
 * honest-disabled-state convention every other WhatsApp CTA on the site
 * already follows (see lib/whatsapp.js, TransactionTypesGrid.js).
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
  const sellHref = getCentralWhatsAppHref('Bonjour, je souhaite lister mon bien sur Lukka Place.');

  return (
    // The search "card" — a white panel floating over the hero photograph,
    // matching web/Design's own hero search unit (radius-panel + a royal-
    // tinted shadow-panel, never a shadow that reads as generic black).
    <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-surface u-shadow-panel">
      <div className="p-4 sm:p-5">
        {/* Row 1: transaction toggle top-left, search-mode toggle top-right.
            flex-wrap lets the mode toggle drop to its own line on narrow
            viewports instead of squeezing both pill groups into
            stacked-then-clipped chaos — verified at a 375px viewport. */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {/* Segmented transaction toggle — the reference portals put this
              choice first because it changes the meaning of every price
              below it. */}
          <div className="inline-flex rounded-full border border-line bg-canvas-alt p-1">
            {TRANSACTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTransaction(value)}
                aria-pressed={transaction === value}
                className={`inline-flex h-10 items-center justify-center rounded-full px-5 text-[0.8125rem] font-semibold transition-colors ${
                  transaction === value ? 'bg-blue text-white' : 'text-ink-70 hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Classique / Recherche IA — same submission pipeline underneath
              (see the doc comment above), just a different placeholder and
              suggestion set. */}
          <div className="inline-flex rounded-full border border-line bg-canvas-alt p-1">
            {SEARCH_MODES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={`inline-flex h-10 items-center justify-center rounded-full px-4 text-[0.8125rem] font-semibold transition-colors ${
                  mode === value ? 'bg-ink text-white' : 'text-ink-70 hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: the input itself — classic dropdown or AI free-text,
            depending on mode. */}
        {isAi ? <p className="mb-2 text-[0.8125rem] font-semibold text-ink">Partagez ce qui compte pour vous</p> : null}

        <label className="sr-only" htmlFor="hero-location">
          {isAi ? 'Partagez ce qui compte pour vous' : 'Commune, quartier ou référence'}
        </label>
        <LocationAutocomplete
          // Remounts the field when the mode changes so stray typed text
          // from one mode doesn't linger into the other's very different
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
          className="rounded-xl border border-line bg-canvas p-2 sm:rounded-full"
          rowClassName="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-0"
          inputClassName="bg-transparent px-4 py-3 text-sm font-medium text-ink placeholder:text-ink-25 focus:outline-none"
        />
      </div>

      {/* WhatsApp cross-sell strip — web/Design's own hero search unit ends
          in a royal-700 band with this exact copy pattern. Real central
          number, honest disabled state when unset (see lib/whatsapp.js),
          same convention every other WhatsApp CTA on the site follows. */}
      <div className="flex flex-col items-start gap-3 bg-blue-deep px-4 py-4 sm:flex-row sm:items-center sm:px-5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.8125rem] font-bold text-white">Vous avez un bien à louer ou à vendre ?</span>
          <span className="text-[0.75rem] text-white/70">
            Envoyez photos et détails sur WhatsApp. Nous vérifions, puis nous publions.
          </span>
        </div>
        {sellHref ? (
          <a
            href={sellHref}
            target="_blank"
            rel="noopener noreferrer"
            className="u-press inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[0.8125rem] font-semibold text-blue-deep transition-colors hover:bg-blue-tint sm:ml-auto"
          >
            Publier par WhatsApp
            <ArrowUpRight strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
          </a>
        ) : (
          <span className="shrink-0 text-[0.75rem] text-white/50 sm:ml-auto">Publication indisponible</span>
        )}
      </div>
    </div>
  );
}
