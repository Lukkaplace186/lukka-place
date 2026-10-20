'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { MapPin } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { DEFAULT_CITY } from '@/lib/cities';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The city the search runs in (2026-10-20). Renders nothing until a second
 * city is public (lib/publicCities.js: MIN_PUBLIC_CITY_LISTINGS live
 * listings), so nobody is ever offered an empty city. Kinshasa is the
 * default and carries no `ville` param, so every existing link is unchanged.
 * Changing city drops every location filter and the map area — a commune of
 * one city means nothing in another — and keeps the rest.
 */
const LOCATION_PARAMS = ['commune', 'communes', 'quartier', 'radius', 'near', 'reference', 'sw_lat', 'sw_lng', 'ne_lat', 'ne_lng', 'page', 'q'];

export default function CityPicker({ cities = [], current = null, className = '' }) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  if (cities.length < 2) return null;

  const value = cities.some((c) => c.name === current) ? current : DEFAULT_CITY;

  function onChange(event) {
    const next = new URLSearchParams(searchParams?.toString() || '');
    for (const key of LOCATION_PARAMS) next.delete(key);
    if (event.target.value === DEFAULT_CITY) next.delete('ville');
    else next.set('ville', event.target.value);
    const qs = next.toString();
    router.push(qs ? `/listings?${qs}` : '/listings');
  }

  return (
    <label className={`relative flex shrink-0 items-center ${className}`}>
      <span className="sr-only">{t('listings.city.label')}</span>
      <MapPin aria-hidden="true" className="pointer-events-none absolute left-3 h-4 w-4 text-ink-muted" strokeWidth={ICON_STROKE_WIDTH} />
      <select
        value={value}
        onChange={onChange}
        className="h-11 appearance-none rounded-lg border-2 border-line bg-surface pl-9 pr-8 text-sm font-semibold text-ink transition-colors focus:border-blue focus:outline-none"
      >
        {cities.map((city) => (
          <option key={city.name} value={city.name}>{city.name}</option>
        ))}
      </select>
    </label>
  );
}
