import { MessageCircle, ShieldCheck, Tag } from 'lucide-react';
import HomeSectionHeader, { HOME_SECTION } from './HomeSectionHeader';
import { getT } from '@/lib/i18n/server';

// Keys, not text — see components/navItems.js on why a module-level constant
// cannot hold translated copy.
const VALUE_PROPS = [
  { id: 'verified', icon: ShieldCheck, titleKey: 'home.value.verifiedTitle', bodyKey: 'home.value.verifiedBody' },
  { id: 'contact', icon: MessageCircle, titleKey: 'home.value.contactTitle', bodyKey: 'home.value.contactBody' },
  { id: 'prices', icon: Tag, titleKey: 'home.value.pricesTitle', bodyKey: 'home.value.pricesBody' },
];

/**
 * "Notre approche" — the three promises, closing the homepage before the
 * footer's partner band.
 *
 * 2026-11-04 landing pass (approved mockup): no boxes. Three short points,
 * each an icon, a title and one line, side by side on a desktop and stacked
 * on a phone, under the homepage's shared section header. They were three
 * bordered numbered cards plus a "Voir les annonces" button — the numbers
 * implied an order the claims do not have, and the button repeated the
 * listings section's own link. The header now links to /a-propos, where the
 * promises are argued at length. The copy was shortened to one line each;
 * the claims are the same.
 */
export default async function ValueProposition() {
  const t = await getT();
  return (
    <section className="bg-canvas">
      <div className={HOME_SECTION}>
        <HomeSectionHeader title={t('home.value.eyebrow')} href="/a-propos" linkLabel={t('home.value.aboutLink')} />
        <ul className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-10">
          {VALUE_PROPS.map(({ id, icon: Icon, titleKey, bodyKey }) => (
            <li key={id} className="flex items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-tint text-blue-deep">
                <Icon strokeWidth={1.75} aria-hidden="true" className="h-[1.375rem] w-[1.375rem]" />
              </span>
              <div className="min-w-0">
                <h3 className="text-[1rem] font-bold leading-snug text-ink">{t(titleKey)}</h3>
                <p className="mt-1.5 text-[0.9375rem] leading-[1.55] text-ink-70 text-pretty">{t(bodyKey)}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
