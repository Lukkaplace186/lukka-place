import Link from 'next/link';
import Price from '@/components/Price';
import { unitListingState } from '@/lib/developmentRules';
import { getT } from '@/lib/i18n/server';

function priceCell(unit) {
  const lo = unit.price_min !== null && unit.price_min !== undefined ? Number(unit.price_min) : null;
  const hi = unit.price_max !== null && unit.price_max !== undefined ? Number(unit.price_max) : null;
  return { lo: lo ?? hi, hi: hi ?? lo };
}

/**
 * A building's unit types — the table the developer is actually selling from.
 * Each row's "Je suis intéressé(e)" pre-selects that type in the enquiry form.
 * A number the developer did not state is a dash, never a zero.
 */
export default async function UnitTypesTable({ project }) {
  const t = await getT();
  const units = project.unit_types || [];
  if (!units.length) return null;

  return (
    <section className="flex flex-col gap-3" id="types">
      <h2 className="u-title-section text-ink">{t('projects.units.title')}</h2>
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <ul className="divide-y divide-line">
          {units.map((unit) => {
            const { lo, hi } = priceCell(unit);
            const period = unit.price_period === 'year' ? 'an' : 'mois';
            const available = unit.units_available;
            const soldOut = available !== null && available !== undefined && Number(available) === 0;
            return (
              <li key={unit.id} className="flex flex-col gap-3 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="font-semibold text-ink">{unit.label}</p>
                  <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[0.8125rem] text-ink-70">
                    {unit.bedrooms !== null ? <span>{t('projects.card.beds', { count: unit.bedrooms })}</span> : null}
                    {unit.bathrooms !== null ? <span>{t('projects.units.baths', { count: unit.bathrooms })}</span> : null}
                    {unit.area_m2 !== null ? <span>{t('projects.units.area', { area: Number(unit.area_m2).toLocaleString('fr-FR') })}</span> : null}
                    <span className="text-ink-45">{unit.purpose === 'rent' ? t('projects.units.rent') : t('projects.units.sale')}</span>
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <div className="flex flex-col items-start sm:items-end">
                    <p className="u-tabular font-bold text-ink">
                      {lo === null ? (
                        <span className="font-semibold text-ink-70">{t('projects.card.priceOnRequest')}</span>
                      ) : lo === hi ? (
                        <Price amount={lo} purpose={unit.purpose} pricePeriod={period} />
                      ) : (
                        <>
                          <span className="mr-1 text-[0.75rem] font-medium text-ink-45">{t('projects.card.from')}</span>
                          <Price amount={lo} purpose={unit.purpose} pricePeriod={period} />
                        </>
                      )}
                    </p>
                    {available !== null && available !== undefined ? (
                      <p className={soldOut ? 'text-[0.8125rem] font-semibold text-danger' : 'text-[0.8125rem] font-semibold text-success'}>
                        {soldOut
                          ? t('projects.units.soldOut')
                          : unit.units_total !== null
                            ? t('projects.units.availableOf', { count: available, total: unit.units_total })
                            : t('projects.units.available', { count: available })}
                      </p>
                    ) : null}
                  </div>
                  <Link
                    href={`?interest=unit:${unit.id}#contact`}
                    className="u-press inline-flex min-h-11 shrink-0 items-center rounded-full bg-blue-tint px-4 text-sm font-semibold text-blue-deep hover:bg-blue hover:text-white"
                  >
                    {t('projects.units.interested')}
                  </Link>
                </div>
                </div>
                {(unit.live_units || []).length ? <LiveUnits units={unit.live_units} purpose={unit.purpose} period={period} t={t} /> : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/**
 * The individual units of a type that is ready now — each a real listing.
 * Available ones link to their own listing page; let/sold ones stay on the
 * list with a "Loué ✓ / Vendu ✓" tag, because a building selling is news a
 * buyer should see, not a row to hide.
 */
function LiveUnits({ units, purpose, period, t }) {
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2">
      {units.map((u) => {
        const state = unitListingState(u);
        const floor = u.unit_floor === null || u.unit_floor === undefined ? null
          : u.unit_floor === 0 ? t('projects.units.groundFloor') : t('projects.units.floorN', { floor: u.unit_floor });
        return (
          <li key={u.id} className="flex items-center justify-between gap-2 rounded-lg bg-canvas-alt px-3 py-2 text-sm">
            <span className="min-w-0 truncate">
              <span className="font-semibold text-ink">{u.unit_label}</span>
              {floor ? <span className="text-ink-45"> · {floor}</span> : null}
            </span>
            {state === 'available' ? (
              <Link href={`/listings/${u.id}`} className="flex shrink-0 items-center gap-2 font-semibold text-blue-deep hover:underline">
                <span className="u-tabular text-ink"><Price amount={Number(u.price)} purpose={purpose} pricePeriod={period} /></span>
                {t('projects.units.seeListing')}
              </Link>
            ) : state === 'reserved' ? (
              <span className="shrink-0 rounded-full bg-warning-tint px-2 py-0.5 text-[0.75rem] font-semibold text-ink">{t('projects.units.reserved')}</span>
            ) : (
              <span className="shrink-0 rounded-full bg-ink px-2 py-0.5 text-[0.75rem] font-semibold text-white">
                {purpose === 'rent' ? t('projects.units.let') : t('projects.units.sold')} ✓
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
