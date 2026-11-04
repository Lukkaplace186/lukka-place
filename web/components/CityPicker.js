'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, MapPin } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { ALL_CITIES, DEFAULT_CITY, isAllCities } from '@/lib/cities';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * The city the search runs in (2026-10-20). Lists the public cities
 * (lib/publicCities.js — every city today, MIN_PUBLIC_CITY_LISTINGS = 0) and
 * renders nothing when there is only one. Kinshasa is the
 * default and carries no `ville` param, so every existing link is unchanged.
 * Changing city drops every location filter and the map area — a commune of
 * one city means nothing in another — and keeps the rest.
 *
 * Two looks, one behaviour:
 *   - `box` (desktop bar): a bordered select beside the search box.
 *   - `inline` (phone, 2026-11-04): one quiet line above the search row,
 *     "Recherche dans : 📍 Kinshasa ⌄", so the phone row is search box +
 *     Filtres only (the Zoopla layout) while the city we cover stays visible.
 */
const LOCATION_PARAMS = ['commune', 'communes', 'quartier', 'radius', 'near', 'reference', 'sw_lat', 'sw_lng', 'ne_lat', 'ne_lng', 'page', 'q'];

export default function CityPicker({ cities = [], current = null, className = '', variant = 'box' }) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  if (cities.length < 2) return null;

  // `current` is the city searched, or "toutes" (every city, 2026-10-24).
  const value = isAllCities(current) ? ALL_CITIES : cities.some((c) => c.name === current) ? current : DEFAULT_CITY;

  function onChange(event) {
    const next = new URLSearchParams(searchParams?.toString() || '');
    for (const key of LOCATION_PARAMS) next.delete(key);
    if (event.target.value === DEFAULT_CITY) next.delete('ville');
    else next.set('ville', event.target.value);
    const qs = next.toString();
    router.push(qs ? `/listings?${qs}` : '/listings');
  }

  const options = (
    <>
      {cities.map((city) => (
        <option key={city.name} value={city.name}>{city.name}</option>
      ))}
      <option value={ALL_CITIES}>{t('listings.city.all')}</option>
    </>
  );

  if (variant === 'inline') {
    return (
      <div className={cn('flex items-center gap-1 text-[0.8125rem] text-ink-45', className)}>
        <span aria-hidden="true">{t('listings.city.searchIn')}</span>
        {/* The visible text is a span and the native select lies over it,
            transparent: a select is as wide as its longest option, which
            left the chevron floating far from "Kinshasa". The select still
            takes the tap and the keyboard, and is 16px (no iOS zoom). */}
        <label className="relative inline-flex min-h-9 items-center rounded-full px-1.5 text-[0.875rem] font-bold text-ink transition-colors focus-within:bg-blue-tint hover:bg-blue-tint">
          <MapPin aria-hidden="true" className="mr-1 h-3.5 w-3.5 text-blue" strokeWidth={ICON_STROKE_WIDTH} />
          <span aria-hidden="true">{value === ALL_CITIES ? t('listings.city.all') : value}</span>
          <ChevronDown aria-hidden="true" className="ml-0.5 h-3.5 w-3.5 text-ink-45" strokeWidth={ICON_STROKE_WIDTH} />
          <select
            value={value}
            onChange={onChange}
            aria-label={t('listings.city.label')}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
          >
            {options}
          </select>
        </label>
      </div>
    );
  }

  return (
    <label className={cn('relative flex shrink-0 items-center', className)}>
      <span className="sr-only">{t('listings.city.label')}</span>
      <MapPin aria-hidden="true" className="pointer-events-none absolute left-3 h-4 w-4 text-ink-muted" strokeWidth={ICON_STROKE_WIDTH} />
      <select
        value={value}
        onChange={onChange}
        className="h-11 w-full appearance-none rounded-lg border-2 border-line bg-surface pl-9 pr-8 text-sm font-semibold text-ink transition-colors focus:border-blue focus:outline-none"
      >
        {options}
      </select>
    </label>
  );
}
