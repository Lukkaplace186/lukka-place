'use client';

import dynamic from 'next/dynamic';

// The app's listing header and bottom bar (listing page), loaded only in app
// mode — see components/app/AppChrome.js.
export const AppListingHeader = dynamic(() => import('./AppListingHeader'));
export const AppListingBar = dynamic(() => import('./AppListingBar'));
