'use client';

import Link from '@/components/IntentLink';
import { Sparkles, BarChart3, Building2, Users } from 'lucide-react';
import SearchBar from './SearchBar';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useLocale, useT } from '@/lib/i18n/client';
import { localizeHref } from '@/lib/localePaths';

// Keys, not text (components/navItems.js). Real pages only.
const SHORTCUTS = [
  { key: 'find', href: '/trouver-pour-moi', icon: Sparkles },
  { key: 'prices', href: '/combien-coute', icon: BarChart3 },
  { key: 'projects', href: '/projets', icon: Building2 },
  { key: 'agencies', href: '/agents', icon: Users },
];

/**
 * The top of the app's home page (app mode, app/(site)/(home)/page.js): a
 * short royal band with a greeting instead of the website's hero photo, the
 * same search card, and four shortcuts. `firstName` is the signed-in
 * customer's own first word of `full_name`, else a plain "Bonjour".
 */
export default function AppHomeTop({ firstName = null, propertyTypes = [], communes = [], initialCount = null, weeklyNew = 0, showProjects = true }) {
  const t = useT();
  const locale = useLocale();
  const shortcuts = SHORTCUTS.filter((s) => showProjects || s.key !== 'projects');

  return (
    <>
      <section className="bg-blue px-4 pb-24 pt-6 text-white">
        <p className="text-[1.625rem] font-extrabold leading-tight tracking-tight">
          {firstName ? t('home.app.greetingNamed', { name: firstName }) : t('home.app.greeting')}
        </p>
        <p className="mt-1 text-sm font-medium text-white/85">{t('home.app.subtitle')}</p>
        {weeklyNew > 0 ? (
          <Link
            href={localizeHref('/listings', locale)}
            className="u-press mt-3 inline-flex min-h-8 items-center gap-2 rounded-full bg-white/15 px-3 text-[0.8125rem] font-semibold text-white"
          >
            <span aria-hidden="true" className="inline-flex h-2 w-2 rounded-full bg-green" />
            {t('home.hero.weeklyNew', { count: weeklyNew })}
          </Link>
        ) : null}
      </section>

      <div className="relative z-20 -mt-20 px-4">
        <SearchBar propertyTypes={propertyTypes} communes={communes} initialCount={initialCount} />
      </div>

      <nav aria-label={t('home.app.shortcuts')} className="px-4 pt-5">
        <ul className={`grid gap-2 ${shortcuts.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
          {shortcuts.map(({ key, href, icon: Icon }) => (
            <li key={key}>
              <Link
                href={localizeHref(href, locale)}
                className="u-press flex flex-col items-center gap-1.5 rounded-xl py-2 text-center text-[0.75rem] font-semibold leading-tight text-ink active:bg-canvas-deep"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-tint text-blue">
                  <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6" />
                </span>
                {t(`home.app.quick.${key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
