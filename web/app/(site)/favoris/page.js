'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Share2, Check, Heart, Bookmark, X } from 'lucide-react';
import PropertyCard from '@/components/PropertyCard';
import Breadcrumb from '@/components/Breadcrumb';
import CardSkeleton from '@/components/CardSkeleton';
import {
  getFavoriteIds,
  subscribeFavorites,
  getSavedSearches,
  subscribeSavedSearches,
  removeSavedSearch,
} from '@/lib/favorites';
import { useIsLoggedIn } from '@/lib/customerClient';
import { ICON_STROKE_WIDTH, SITE_URL } from '@/lib/constants';

const EMPTY_LIST = [];

/**
 * `?ids=` as an external store.
 *
 * Same shape as lib/favorites.js's cached readers, and for the same reason:
 * useSyncExternalStore requires getSnapshot to return a stable reference, so
 * the parsed array is cached against the raw query string. Reading the
 * location this way — rather than setting state inside an effect — is what
 * the "subscribe to an external system" rule actually asks for.
 */
let cachedSearch;
let cachedIds = EMPTY_LIST;

function getShareIds() {
  if (typeof window === 'undefined') return EMPTY_LIST;
  const search = window.location.search;
  if (search !== cachedSearch) {
    cachedSearch = search;
    const raw = new URLSearchParams(search).get('ids');
    const parsed = raw ? raw.split(',').filter(Boolean) : EMPTY_LIST;
    cachedIds = parsed.length > 0 ? parsed : EMPTY_LIST;
  }
  return cachedIds;
}

function subscribeToLocation(callback) {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}

/**
 * Local-only Favorites + Saved searches (see lib/favorites.js — no accounts
 * backend exists, so this reads entirely from the visitor's own
 * localStorage). Client component for that reason, so it cannot export
 * `metadata` and keeps the root layout's default title.
 *
 * The shared-list (`?ids=`) section deliberately does NOT use
 * `useSearchParams()`. That hook forces a Suspense boundary around whatever
 * calls it, and this page previously called it at the top level — which put
 * the *entire* page inside `<Suspense fallback={null}>` and rendered <main>
 * completely empty until the boundary hydrated. Verified in a real browser:
 * the page showed nothing at all, not even the heading, and the boundary
 * never resolved.
 *
 * Since `?ids=` is only ever reached by opening a pasted share link, reading
 * `location.search` once on mount is sufficient and removes the boundary
 * entirely. The trade-off is that this section will not react to a
 * client-side change of that one query param — nothing in the app does that,
 * and the rest of the page (favorites, saved searches) is driven by
 * localStorage subscriptions rather than the URL.
 */
export default function FavorisPage() {
  // Only changes the header copy below — the data-fetching sections
  // (favorites/saved searches) already dispatch to the right backend
  // regardless, via lib/favorites.js's own login check.
  const loggedIn = useIsLoggedIn();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <Breadcrumb className="mb-6" items={[{ label: 'Accueil', href: '/' }, { label: 'Favoris' }]} />

      <header className="mb-10">
        <h1 className="font-display text-[2rem] font-normal leading-[1.12] tracking-[-0.02em] text-ink sm:text-[2.5rem]">
          Mes favoris
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-45">
          {loggedIn
            ? 'Vos biens et recherches enregistrés sont conservés sur votre compte, accessibles depuis n’importe quel appareil.'
            : 'Connectez-vous pour retrouver vos biens favoris et vos recherches enregistrées.'}
        </p>
        {!loggedIn ? (
          <Link
            href={`/compte/connexion?next=${encodeURIComponent('/favoris')}`}
            className="mt-4 inline-flex items-center rounded-full bg-blue px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
          >
            Se connecter
          </Link>
        ) : null}
      </header>

      <SharedListSection />

      <FavoritesSection />
      <SavedSearchesSection />
    </div>
  );
}

function SectionTitle({ icon: Icon, children, action }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 border-b border-line pb-3">
      <h2 className="flex items-center gap-2">
        <Icon strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-4 w-4 text-ink-45" />
        <span className="u-eyebrow">{children}</span>
      </h2>
      {action}
    </div>
  );
}

/** Fetches real listings for a set of ids, or null while loading. */
function useListingsByIds(ids) {
  const [listings, setListings] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const promise =
      ids.length === 0
        ? Promise.resolve({ data: [] })
        : fetch(`/api/listings?ids=${ids.join(',')}`).then((res) => res.json());

    promise.then((json) => {
      if (!cancelled) setListings(json.data || []);
    });

    return () => {
      cancelled = true;
    };
  }, [ids]);

  return listings;
}

function FavoritesSection() {
  const favoriteIds = useSyncExternalStore(subscribeFavorites, getFavoriteIds, () => EMPTY_LIST);
  const listings = useListingsByIds(favoriteIds);
  const [copied, setCopied] = useState(false);

  function handleShare() {
    const shareUrl = `${SITE_URL}/favoris?ids=${favoriteIds.join(',')}`;
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Denied clipboard permission or an insecure context. Leave the
        // button reading "Partager" rather than claiming a copy that did
        // not happen.
      });
  }

  const displayListings = listings || EMPTY_LIST;

  return (
    <section className="mt-10">
      <SectionTitle
        icon={Heart}
        action={
          favoriteIds.length > 0 ? (
            <button
              type="button"
              onClick={handleShare}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[0.75rem] font-semibold transition-colors ${
                copied
                  ? 'border-blue bg-blue-tint text-blue-deep'
                  : 'border-line text-ink-70 hover:border-blue hover:text-blue-deep'
              }`}
            >
              {copied ? (
                <>
                  <Check strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                  Lien copié
                </>
              ) : (
                <>
                  <Share2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                  Partager
                </>
              )}
            </button>
          ) : null
        }
      >
        Biens favoris
      </SectionTitle>

      {listings === null ? (
        <div className="flex flex-col gap-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : displayListings.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface px-6 py-14 text-center">
          <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-canvas-alt text-ink-45">
            <Heart strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
          </span>
          <h3 className="u-title-section text-ink">Rien d&apos;enregistré</h3>
          <p className="mx-auto mt-2 max-w-sm text-[0.875rem] leading-relaxed text-ink-45">
            Touchez le cœur sur une annonce pour la retrouver ici, et partagez votre sélection en un lien.
          </p>
          <Link
            href="/listings"
            className="mt-7 inline-flex items-center rounded-full bg-blue px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
          >
            Parcourir les annonces
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {displayListings.map((listing) => (
            <PropertyCard key={listing.id} listing={listing} layout="horizontal" />
          ))}
        </div>
      )}
    </section>
  );
}

function SavedSearchesSection() {
  const savedSearches = useSyncExternalStore(subscribeSavedSearches, getSavedSearches, () => EMPTY_LIST);

  return (
    <section className="mt-14">
      <SectionTitle icon={Bookmark}>Recherches sauvegardées</SectionTitle>

      {savedSearches.length === 0 ? (
        <p className="rounded-lg border border-line bg-canvas-alt px-5 py-4 text-[0.875rem] text-ink-45">
          Aucune recherche sauvegardée. Depuis la page des annonces, enregistrez une recherche pour la relancer en un
          clic.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {savedSearches.map((search) => (
            <li
              key={search.query}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3.5 transition-colors hover:border-ink-25"
            >
              <Link href={search.href} className="min-w-0 flex-1 text-[0.875rem] font-medium text-ink hover:text-blue-deep">
                {search.label}
              </Link>
              <button
                type="button"
                onClick={() => removeSavedSearch(search.query)}
                aria-label={`Supprimer la recherche ${search.label}`}
                className="shrink-0 rounded-full p-1 text-ink-25 transition-colors hover:bg-canvas-deep hover:text-ink"
              >
                <X strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * `?ids=12,45,90` — a shared favorites link built by the "Partager" button.
 * This is the only part of the page that needs the query string, so it is
 * the only part inside the Suspense boundary.
 *
 * Opening someone else's link never writes those ids into this browser's
 * storage; each card carries its own real FavoriteButton so a visitor who
 * wants to keep one hearts it deliberately.
 */
function SharedListSection() {
  // Server snapshot is always empty (there is no location server-side), so
  // this cannot cause a hydration mismatch.
  const ids = useSyncExternalStore(subscribeToLocation, getShareIds, () => EMPTY_LIST);
  const listings = useListingsByIds(ids);

  if (ids.length === 0) return null;

  return (
    <section className="rounded-lg border border-blue/30 bg-blue-tint/40 p-5 sm:p-6">
      <SectionTitle icon={Share2}>Liste partagée</SectionTitle>
      {listings === null ? (
        <CardSkeleton />
      ) : listings.length === 0 ? (
        <p className="text-[0.875rem] text-ink-45">Cette liste partagée ne contient plus de biens disponibles.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {listings.map((listing) => (
            <PropertyCard key={listing.id} listing={listing} layout="horizontal" />
          ))}
        </div>
      )}
    </section>
  );
}
