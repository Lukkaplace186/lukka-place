import { Bath, BedDouble, Briefcase, DoorOpen, FileText, Landmark, Layers, Ruler, Store, Truck } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import { entryTerms, specItems } from '@/lib/listingView';
import { commercialFacts, isCommercial } from '@/lib/commercialSpaces';

const SPEC_ICONS = { beds: BedDouble, bath: Bath, area: Ruler, units: DoorOpen, offices: Briefcase };
const COMMERCIAL_ICONS = { floor: Layers, frontage: Store, truck: Truck };

/**
 * The listing page's facts as one line under the title (2026-11-18, owner:
 * a smoother page after the big portals — Zillow's "3 bd | 2 ba | 85 m²",
 * Airbnb's "2 bedrooms · 2 baths"). It replaces the four-up KeyFacts grid on
 * that page and says the same facts, real columns only:
 *
 * - the type (`category_name`, untranslated: it is a value, not UI copy);
 * - rooms, bathrooms, surface, doors and offices with the cards' own short
 *   labels (specItems: "2 ch", "2 sdb", "85 m²");
 * - an office's or shop's floor, frontage and truck access;
 * - a guarantee-only listing's deposit, never the 3 + 1 + 1 total (that has
 *   its own card, EntryCostsBreakdown);
 * - the reference on its own line: an agent quotes it on WhatsApp and the
 *   search bar accepts it, so it is shown whole, never truncated.
 *
 * Nothing renders for a listing that states none of it.
 */
export default async function ListingFactsRow({ listing }) {
  const t = await getT();
  const commercial = isCommercial(listing);
  const items = [];

  if (listing.category_name) items.push({ key: 'type', icon: Landmark, text: listing.category_name });
  for (const spec of specItems(listing, t)) {
    const text = spec.key === 'bath' && commercial
      ? `${spec.value} ${t('listings.commercial.facts.toilets').toLowerCase()}`
      : `${spec.value} ${spec.label}`;
    items.push({ key: spec.key, icon: SPEC_ICONS[spec.key] || Ruler, text });
  }
  if (commercial) {
    for (const fact of commercialFacts(listing, t)) {
      if (fact.key === 'offices') continue; // already in specItems
      items.push({ key: fact.key, icon: COMMERCIAL_ICONS[fact.key] || Layers, text: `${fact.label} : ${fact.value}` });
    }
  }
  const terms = entryTerms(listing);
  if (terms && !terms.itemized) {
    items.push({
      key: 'deposit',
      icon: FileText,
      text: `${t('listings.facts.deposit')} : ${t('listings.facts.months', { count: terms.parts[0] })}`,
    });
  }

  const reference = typeof listing.reference === 'string' ? listing.reference.trim() : listing.reference;
  if (!items.length && !reference) return null;

  return (
    <div id="apercu" className="flex scroll-mt-32 flex-col gap-2">
      {items.length ? (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.9375rem] text-ink">
          {items.map(({ key, icon: Icon, text }) => (
            <li key={key} className="u-tabular inline-flex items-center gap-1.5">
              <Icon strokeWidth={1.75} className="h-4 w-4 shrink-0 text-blue" aria-hidden="true" />
              {text}
            </li>
          ))}
        </ul>
      ) : null}
      {reference ? (
        <p className="flex items-start gap-1.5 text-sm text-ink-70">
          <FileText strokeWidth={1.75} className="mt-0.5 h-4 w-4 shrink-0 text-ink-45" aria-hidden="true" />
          <span className="min-w-0 break-words">
            {t('listings.facts.reference')} : {reference}
          </span>
        </p>
      ) : null}
    </div>
  );
}
