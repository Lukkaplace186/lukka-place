import { Banknote, Bed, Dumbbell, Fuel, Home, Ruler, Sun, Users, WavesLadder, Zap } from 'lucide-react';
import Price from '@/components/Price';
import { getT } from '@/lib/i18n/server';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { detailsOf, plotAreaLabel, plotAreaOf, pricePerM2 } from '@/lib/listingDetails';

/**
 * "Détails pratiques" on the listing page (lib/listingDetails.js): meublé,
 * households sharing the parcelle, landlord on site, generator, pool, gym, solar,
 * electricity meter, plot size with its price per m² on a sale, paiement
 * échelonné. Captioned "Déclaré par l'agent" like the utility tags — nobody
 * from Lukka Place has checked them. Only stated facts render; nothing at all
 * renders for a listing that states none.
 */
export default async function PracticalDetails({ listing }) {
  const d = detailsOf(listing);
  const t = await getT();
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

  const plotM2 = Number(d.plot_area_m2) > 0 ? Number(d.plot_area_m2) : null;
  const plotLabel = plotM2 ? plotAreaLabel(plotM2, t.locale) : d.plot_dimensions || null;
  const perM2 = pricePerM2(listing);
  const installments = d.installments_available === true;

  if (!items.length && !plotLabel && !perM2 && !installments) return null;

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="practical-details-title">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="practical-details-title" className="u-title-card text-ink">{t('listings.details.title')}</h2>
        <span className="text-xs text-ink-45">{t('listings.details.declared')}</span>
      </div>
      {items.length ? (
        <ul className="flex flex-wrap gap-2">
          {items.map(({ key, icon: Icon, label }) => (
            <li key={key} className="inline-flex items-center gap-1.5 rounded-full bg-canvas-alt px-3 py-1.5 text-sm font-semibold text-ink">
              <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-blue-deep" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
      ) : null}
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
    </section>
  );
}
