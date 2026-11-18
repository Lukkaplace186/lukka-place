import { Banknote, Bed, Dumbbell, Fuel, Home, Ruler, Sun, Users, WavesLadder, Zap } from 'lucide-react';
import Price from '@/components/Price';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { detailsOf, plotAreaLabel, plotAreaOf, pricePerM2 } from '@/lib/listingDetails';

/**
 * The "practical details" the agent stated (lib/listingDetails.js): meublé,
 * households sharing the parcelle, landlord on site, generator, pool, gym,
 * solar, electricity meter, plot size with its price per m² on a sale,
 * paiement échelonné. Only stated facts — nothing for a fact not stated.
 *
 * Since 2026-11-18 these render inside the listing page's single
 * "Équipements" section (ListingEquipment.js) with the utility tags, instead
 * of a "Détails pratiques" card of their own, so this file holds the pieces.
 */

/** The chips: [{ key, icon, label }], stated facts only. */
export function practicalDetailItems(listing, t) {
  const d = detailsOf(listing);
  const items = [];
  if (d.furnished === true) items.push({ key: 'furnished', icon: Bed, label: t('listings.details.furnished') });
  if (d.furnished === false) items.push({ key: 'furnished', icon: Bed, label: t('listings.details.unfurnished') });
  if (Number(d.households_count) > 0) {
    items.push({ key: 'households', icon: Users, label: t('listings.details.households', { count: d.households_count }) });
  }
  if (d.landlord_on_site === true) items.push({ key: 'landlord', icon: Home, label: t('listings.details.landlordOn') });
  if (d.landlord_on_site === false) items.push({ key: 'landlord', icon: Home, label: t('listings.details.landlordOff') });
  if (d.has_generator === true) items.push({ key: 'generator', icon: Fuel, label: t('listings.details.form.generator') });
  if (d.has_solar === true) items.push({ key: 'solar', icon: Sun, label: t('listings.details.form.solar') });
  if (d.has_pool === true) items.push({ key: 'pool', icon: WavesLadder, label: t('listings.details.form.pool') });
  if (d.has_gym === true) items.push({ key: 'gym', icon: Dumbbell, label: t('listings.details.form.gym') });
  if (['prepaye', 'individuel', 'partage'].includes(d.electricity_meter)) {
    items.push({ key: 'meter', icon: Zap, label: t(`listings.details.meter.${d.electricity_meter}`) });
  }
  return items;
}

/** The lines that are not chips: plot size (and price per m²), installments. */
export function practicalExtrasOf(listing, t) {
  const d = detailsOf(listing);
  const plotM2 = Number(d.plot_area_m2) > 0 ? Number(d.plot_area_m2) : null;
  return {
    d,
    plotM2,
    plotLabel: plotM2 ? plotAreaLabel(plotM2, t.locale) : d.plot_dimensions || null,
    perM2: pricePerM2(listing),
    installments: d.installments_available === true,
  };
}

export function PracticalExtras({ listing, extras, t }) {
  const { d, plotM2, plotLabel, perM2, installments } = extras;
  if (!plotLabel && !perM2 && !installments) return null;
  return (
    <>
      {plotLabel || perM2 ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink">
          <Ruler strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-blue-deep" aria-hidden="true" />
          {plotLabel ? <span className="font-semibold">{t('listings.details.plot', { size: plotLabel })}</span> : null}
          {d.plot_dimensions && plotM2 ? <span className="text-ink-45">« {d.plot_dimensions} »</span> : null}
          {perM2 && plotAreaOf(listing) ? (
            <span className="u-tabular text-ink-70">
              · ≈ <Price amount={perM2} purpose="sale" className="font-semibold" /> {t('listings.details.perM2')}
            </span>
          ) : null}
        </p>
      ) : null}
      {installments ? (
        <p className="mt-3 flex flex-wrap items-start gap-2 text-sm text-ink">
          <Banknote strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-blue-deep" aria-hidden="true" />
          <span>
            <span className="font-semibold">{t('listings.details.installments')}</span>
            {d.installment_terms ? <span className="text-ink-70"> — {t('listings.details.installmentTerms', { terms: d.installment_terms })}</span> : null}
          </span>
        </p>
      ) : null}
    </>
  );
}
