import { Droplets, Route, Shield, Zap } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { UTILITY_FILTERS, normaliseUtilities, utilityGroupOf, utilityLabelKey } from '@/lib/utilityTags';
import { PracticalExtras, practicalDetailItems, practicalExtrasOf } from './PracticalDetails';

const UTILITY_ICONS = { zap: Zap, droplets: Droplets, shield: Shield, route: Route };

/**
 * "Équipements" on the listing page (2026-11-18, owner): the utility codes
 * (properties.utilities: power, water, security, access) and the practical
 * details (lib/listingDetails.js) in ONE chip list. They used to be two
 * cards, "Courant, eau, sécurité, accès" and "Détails pratiques", and a
 * listing with a generator said so in both.
 *
 * - The same fact once: the utility code wins over the detail flag it
 *   duplicates (`groupe` over `has_generator`, `solaire` over `has_solar`).
 * - Captioned "Déclaré par l’agent", never "vérifié": nobody from Lukka Place
 *   has checked the SNEL line or the meter, and "Vérifié" belongs to
 *   `verified_at` only.
 * - Nothing renders for a listing that states none of it.
 */
export const DUPLICATE_OF_UTILITY = Object.freeze({ generator: 'groupe', solar: 'solaire' });

export default async function ListingEquipment({ listing }) {
  const t = await getT();
  const codes = normaliseUtilities(listing.utilities);
  const utilityChips = codes.map((code) => ({
    key: `utility-${code}`,
    icon: UTILITY_ICONS[UTILITY_FILTERS[utilityGroupOf(code)]?.icon] || Zap,
    label: t(utilityLabelKey(code)),
  }));
  const detailChips = practicalDetailItems(listing, t).filter(
    (item) => !(DUPLICATE_OF_UTILITY[item.key] && codes.includes(DUPLICATE_OF_UTILITY[item.key])),
  );
  const chips = [...utilityChips, ...detailChips];
  const extras = practicalExtrasOf(listing, t);
  if (!chips.length && !extras.plotLabel && !extras.perM2 && !extras.installments) return null;

  return (
    // A flat section with the page's other headings (2026-11-18): the
    // listing page separates sections by a hairline, not by cards.
    <section aria-labelledby="equipment-title">
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="equipment-title" className="u-h2 text-ink">{t('listings.details.form.equipment')}</h2>
        <span className="text-xs text-ink-45">{t('listings.utilities.declared')}</span>
      </div>
      {chips.length ? (
        <ul className="flex flex-wrap gap-2">
          {chips.map(({ key, icon: Icon, label }) => (
            <li key={key} className="inline-flex items-center gap-1.5 rounded-full bg-canvas-alt px-3 py-1.5 text-sm font-semibold text-ink">
              <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-blue-deep" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
      ) : null}
      <PracticalExtras listing={listing} extras={extras} t={t} />
    </section>
  );
}
