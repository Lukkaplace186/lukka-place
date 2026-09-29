import { Droplets, Route, Shield, Zap } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { UTILITY_FILTERS, normaliseUtilities, utilityGroupOf, utilityLabelKey } from '@/lib/utilityTags';

const ICONS = { zap: Zap, droplets: Droplets, shield: Shield, route: Route };

/**
 * The Kinshasa utility codes the agent stated (properties.utilities), grouped
 * power / water / security / access, captioned "Déclaré par l'agent" — never
 * "vérifié": nobody from Lukka Place has checked the SNEL line, and
 * "Vérifié" belongs to `verified_at` only. Renders nothing without codes.
 */
export default async function UtilityBadges({ utilities }) {
  const codes = normaliseUtilities(utilities);
  if (!codes.length) return null;
  const t = await getT();
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="utilities-title">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="utilities-title" className="u-title-card text-ink">{t('listings.utilities.title')}</h2>
        <span className="text-xs text-ink-45">{t('listings.utilities.declared')}</span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {codes.map((code) => {
          const Icon = ICONS[UTILITY_FILTERS[utilityGroupOf(code)]?.icon] || Zap;
          return (
            <li key={code} className="inline-flex items-center gap-1.5 rounded-full bg-canvas-alt px-3 py-1.5 text-sm font-semibold text-ink">
              <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-blue-deep" aria-hidden="true" />
              {t(utilityLabelKey(code))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
