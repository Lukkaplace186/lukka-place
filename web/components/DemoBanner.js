import { cookies } from 'next/headers';
import { demoSidesFromCookies } from '@/lib/demoSession';
import { getDemoAccount } from '@/lib/demoAccounts';
import { getT } from '@/lib/i18n/server';
import DemoBannerActions from './DemoBannerActions';

/**
 * "Mode démo" bar, while this browser is signed into a demo pair
 * (lib/demoSession.js). Bottom of the viewport like the "view as" banner,
 * for the same reason (the storefront header and its sticky offsets own the
 * top), but compact: the demo is meant to be used, not watched.
 */
export default async function DemoBanner() {
  let sides = null;
  try {
    sides = demoSidesFromCookies(await cookies());
  } catch {
    return null;
  }
  if (!sides) return null;

  let pair = null;
  try {
    pair = await getDemoAccount(sides.pairId);
  } catch (err) {
    console.error(`[demo] banner could not read pair #${sides.pairId}: ${err.message}`);
  }
  const t = await getT();
  const both = sides.agentSide && sides.customerSide;
  const side = both
    ? t('common.demo.bothSides')
    : t(sides.agentSide ? 'common.demo.agentSide' : 'common.demo.customerSide');

  return (
    <div
      role="status"
      data-demo-banner={sides.pairId}
      className="fixed bottom-4 left-1/2 z-[100] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 rounded-card bg-[var(--warning-ink)] px-4 py-2.5 text-white shadow-lg print:hidden"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="u-micro-strong">{t('common.demo.active', { label: pair?.label || `#${sides.pairId}`, side })}</div>
          <div className="u-micro text-white/80">{t('common.demo.sealed')}</div>
        </div>
        <DemoBannerActions
          pairId={sides.pairId}
          switchTo={both ? null : (sides.agentSide ? 'customer' : 'agent')}
        />
      </div>
    </div>
  );
}
