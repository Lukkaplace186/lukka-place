import { Check } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import { listingFeatures } from '@/lib/descriptionParser';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * "Caractéristiques principales" + the full description, in that order —
 * the Zoopla/Rightmove "Features and description" block, asked for directly
 * off a Zoopla screenshot.
 *
 * WHAT CHANGED AND WHY IT IS ONE COMPONENT, NOT TWO
 * The detail page used to render a description paragraph in one place and a
 * separate "Équipements confirmés" chip row further down, with a two-line
 * caption explaining where those chips came from. A reader scanning on a
 * phone met a wall of prose first and the scannable part only after
 * scrolling past it. Merging them puts the scannable list on top, and —
 * more importantly — keeps the honesty caption physically attached to the
 * list it qualifies. They were two sections that had to agree; now they
 * cannot disagree.
 *
 * THE CAPTION IS NOT BOILERPLATE
 * It changes with `source` (see lib/descriptionParser.js) because the three
 * sources are genuinely different claims:
 *   'column'      — the extraction pass filled `properties.features` from
 *                   the agent's own message.
 *   'amenities'   — we matched a keyword in the listing's own text. Real,
 *                   but a listing can have a feature and never mention it,
 *                   so this is a floor and not an inventory. This is the
 *                   wording the old chip section already carried, kept.
 *   'description' — the description's own lines, reformatted. We added no
 *                   fact at all, and the caption says so.
 *
 * A SERVER COMPONENT. Nothing here is interactive, so none of it needs to
 * reach the browser as JS — `await getT()` rather than `useT()`, which also
 * means this file must never be imported from a `'use client'` file (see
 * web/CLAUDE.md's i18n section).
 */
export default async function PropertyDescription({ listing }) {
  const t = await getT();
  const { items, source } = listingFeatures(listing, t);

  if (!items.length && !listing.description) return null;

  const captionKey = {
    column: 'listings.detail.featuresFromAgent',
    amenities: 'listings.detail.featuresFromText',
    description: 'listings.detail.featuresFromDescription',
  }[source];

  return (
    <div className="flex flex-col gap-7">
      {items.length > 0 ? (
        <section className="flex flex-col gap-3.5">
          <h2 className="u-h2 text-ink">{t('listings.detail.keyFeatures')}</h2>

          {/* Two columns from `sm` up, one below it. A feature is a short
              phrase, so a single column on a wide viewport leaves most of
              the row empty and pushes the description an extra screen
              down; two columns on a 320px phone would break the labels
              mid-word. `gap-x-8` keeps the two columns visibly separate
              without a rule between them — the tight `gap-y-2` is the
              vertical rhythm the reference portals use, closer than this
              app's usual list spacing on purpose. */}
          <ul className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
            {items.map(({ id, label }) => (
              <li key={id} className="flex items-start gap-2.5 text-[0.9375rem] leading-[1.5] text-ink">
                {/* `mt-[3px]` optically centres a 16px glyph against the
                    first line of a 15px/1.5 label rather than against the
                    whole (possibly two-line) item. */}
                <Check
                  strokeWidth={ICON_STROKE_WIDTH}
                  aria-hidden="true"
                  className="mt-[3px] h-4 w-4 shrink-0 text-blue"
                />
                <span className="min-w-0">{label}</span>
              </li>
            ))}
          </ul>

          {captionKey ? (
            <p className="max-w-[42rem] text-[0.8125rem] leading-[1.5] text-ink-35">{t(captionKey)}</p>
          ) : null}
        </section>
      ) : null}

      {listing.description ? (
        <section className="flex flex-col gap-3">
          <h2 className="u-h2 text-ink">{t('listings.detail.description')}</h2>
          <p className="u-body max-w-[46rem] whitespace-pre-line text-ink-70">{listing.description}</p>
        </section>
      ) : null}
    </div>
  );
}
