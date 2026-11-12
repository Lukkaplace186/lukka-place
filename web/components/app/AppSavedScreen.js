'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from '@/components/LocaleLink';
import { Bell, ChevronRight, CircleAlert, Heart, Search } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import AppSegmented from './AppSegmented';
import AppSwitch from './AppSwitch';
import AppSavedRow from './AppSavedRow';
import { getFavoriteIds, getSavedSearches, subscribeFavorites, subscribeSavedSearches } from '@/lib/favorites';
import { ALERT_FREQUENCY_LABEL_KEYS, DEFAULT_ALERT_FREQUENCY } from '@/lib/alertPreferences';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { updateAlertPreferencesAction } from '@/app/(site)/compte/client/actions';

const EMPTY = [];

/** Real listings for the saved ids (GET /api/listings?ids=, the public gate applies), or null while loading. */
function useListingsByIds(ids) {
  const [listings, setListings] = useState(null);
  const key = ids.join(',');
  useEffect(() => {
    let cancelled = false;
    const load = key ? fetch(`/api/listings?ids=${key}`).then((r) => r.json()) : Promise.resolve({ data: [] });
    load
      .then((json) => !cancelled && setListings(json.data || []))
      .catch(() => !cancelled && setListings([]));
    return () => {
      cancelled = true;
    };
  }, [key]);
  return listings;
}

function Empty({ icon: Icon, title, text, action = null }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-tint text-blue">
        <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="mt-4 text-[1.0625rem] font-bold text-ink">{title}</p>
      <p className="mt-1.5 max-w-xs text-[0.9375rem] text-ink-70">{text}</p>
      {action}
    </div>
  );
}

function HomesTab() {
  const t = useT();
  const ids = useSyncExternalStore(subscribeFavorites, getFavoriteIds, () => EMPTY);
  const listings = useListingsByIds(ids);

  if (!ids.length) {
    return (
      <Empty
        icon={Heart}
        title={t('appShell.saved.emptyHomesTitle')}
        text={t('appShell.saved.emptyHomesText')}
        action={
          <Link href="/listings" className="u-press mt-5 rounded-xl bg-blue px-5 py-3 text-[0.9375rem] font-semibold text-white">
            {t('appShell.saved.browse')}
          </Link>
        }
      />
    );
  }
  if (listings === null) {
    return (
      <div className="space-y-3" aria-busy="true">
        {ids.slice(0, 3).map((id) => (
          // Shaped like the row it stands in for: photo, price, place, facts.
          <div key={id} className="flex overflow-hidden rounded-2xl border border-line bg-surface">
            <Skeleton className="h-[6.5rem] w-28 rounded-none" />
            <div className="flex-1 space-y-2 p-3.5">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3.5 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  // Saved in the order they were saved; a listing no longer public is counted, never shown.
  const byId = new Map(listings.map((l) => [String(l.id), l]));
  const shown = ids.map((id) => byId.get(String(id))).filter(Boolean);
  const gone = ids.length - shown.length;
  return (
    <div className="space-y-3">
      {shown.map((listing) => (
        <AppSavedRow key={listing.id} listing={listing} />
      ))}
      {gone > 0 ? <p className="px-1 text-[0.8125rem] text-ink-45">{t('appShell.saved.gone', { count: gone })}</p> : null}
    </div>
  );
}

function AccountSearch({ search }) {
  const t = useT();
  const [frequency, setFrequency] = useState(search.alert_frequency || DEFAULT_ALERT_FREQUENCY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const on = frequency !== 'off';

  async function toggle(next) {
    const previous = frequency;
    const wanted = next ? DEFAULT_ALERT_FREQUENCY : 'off';
    setFrequency(wanted);
    setBusy(true);
    setError(null);
    try {
      const result = await updateAlertPreferencesAction(search.id, { frequency: wanted });
      if (!result?.ok) throw new Error(result?.error || 'failed');
    } catch (err) {
      // Offline or refused: put the switch back and say so.
      setFrequency(previous);
      setError(err?.message && err.message !== 'failed' ? err.message : t('account.alerts.prefsFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-2xl border border-line bg-surface">
      <Link href={`/listings?${search.query || ''}`} className="flex items-center gap-3 px-4 pb-3 pt-3.5">
        <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-bold text-ink">{search.label || t('appShell.home.continueFallback')}</span>
        <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 flex-none text-ink-45" aria-hidden="true" />
      </Link>
      <div className="flex items-center gap-3 border-t border-line px-4 py-3">
        <Bell strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 flex-none text-ink-45" aria-hidden="true" />
        <span className="flex-1 text-[0.875rem] text-ink-70">
          {t('appShell.saved.alerts')}
          <span className="text-ink-45"> · {t(ALERT_FREQUENCY_LABEL_KEYS[frequency] || ALERT_FREQUENCY_LABEL_KEYS.off)}</span>
        </span>
        <AppSwitch checked={on} onChange={toggle} busy={busy} label={`${t('appShell.saved.alerts')} — ${search.label || ''}`} />
      </div>
      {error ? (
        <div className="px-3 pb-3">
          <Alert variant="destructive" className="py-2.5">
            <CircleAlert />
            <AlertDescription className="text-[0.8125rem] text-ink">{error}</AlertDescription>
          </Alert>
        </div>
      ) : null}
    </li>
  );
}

function SearchesTab({ accountSearches }) {
  const t = useT();
  const localSearches = useSyncExternalStore(subscribeSavedSearches, getSavedSearches, () => EMPTY);
  const signedIn = Array.isArray(accountSearches);
  const searches = signedIn ? accountSearches : localSearches;

  if (!searches.length) {
    return <Empty icon={Search} title={t('appShell.saved.emptySearchesTitle')} text={t('appShell.saved.searchesHint')} />;
  }
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {signedIn
          ? searches.map((search) => <AccountSearch key={search.id} search={search} />)
          : searches.map((search) => (
              <li key={search.query}>
                <Link href={search.href || `/listings?${search.query}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5">
                  <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-bold text-ink">{search.label}</span>
                  <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 flex-none text-ink-45" aria-hidden="true" />
                </Link>
              </li>
            ))}
      </ul>
      {signedIn ? (
        <p className="px-1 text-[0.8125rem] text-ink-45">{t('appShell.saved.searchesHint')}</p>
      ) : (
        <p className="px-1 text-[0.8125rem] text-ink-70">
          {t('appShell.saved.signInForAlerts')}{' '}
          <Link href="/compte/connexion?next=%2Ffavoris" className="font-semibold text-blue">
            {t('appShell.account.signIn')}
          </Link>
        </p>
      )}
    </div>
  );
}

/**
 * The app's Saved tab (the app design, "Saved homes" / "Saved searches and
 * alerts"), on the same stores the website uses (lib/favorites.js: the
 * account when signed in, this phone otherwise). `accountSearches` is the
 * signed-in customer's saved searches with their id and alert frequency
 * (null when signed out); the switch writes through the Alertes tab's own
 * action, so both always agree.
 */
export default function AppSavedScreen({ accountSearches = null }) {
  const t = useT();
  const [tab, setTab] = useState('homes');

  return (
    <div className="min-h-full bg-canvas-alt">
      <div className="mx-auto max-w-lg px-4 pb-8 pt-6">
        <h1 className="text-[1.75rem] font-extrabold tracking-tight text-ink">{t('appShell.saved.title')}</h1>
        <div className="mt-4">
          <AppSegmented
            id="saved"
            label={t('appShell.saved.title')}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'homes', label: t('appShell.saved.homes') },
              { value: 'searches', label: t('appShell.saved.searches') },
            ]}
          />
        </div>
        <div role="tabpanel" className="mt-4">
          {tab === 'homes' ? <HomesTab /> : <SearchesTab accountSearches={accountSearches} />}
        </div>
      </div>
    </div>
  );
}
