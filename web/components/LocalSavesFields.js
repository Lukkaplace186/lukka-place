'use client';

import { useEffect, useRef } from 'react';
import { getFavoriteIds, getSavedSearches } from '@/lib/localFavorites';

/**
 * Two hidden fields carrying this browser's saved homes and searches into a
 * form that may open an account (2026-11-24: a new number is signed in at
 * once — lib/newCustomerSession.js merges them). Filled when mounted and again
 * when the form is submitted, so a home saved after the form appeared still
 * comes along. Read on the server by `localSavesFromForm`.
 */
export default function LocalSavesFields() {
  const ref = useRef(null);

  useEffect(() => {
    const input = ref.current;
    const form = input?.form;
    if (!form) return undefined;
    const fill = () => {
      try {
        form.elements.namedItem('favoriteIds').value = getFavoriteIds().join(',');
        form.elements.namedItem('savedSearches').value = JSON.stringify(getSavedSearches());
      } catch {
        // Storage blocked: the account opens without them.
      }
    };
    fill();
    // Before React reads the form (its listener sits on the root, after this one).
    form.addEventListener('submit', fill);
    return () => form.removeEventListener('submit', fill);
  }, []);

  return (
    <>
      <input ref={ref} type="hidden" name="favoriteIds" defaultValue="" />
      <input type="hidden" name="savedSearches" defaultValue="[]" />
    </>
  );
}
