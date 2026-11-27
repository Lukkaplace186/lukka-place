'use client';

import dynamic from 'next/dynamic';

// The app's guide header (commune page), loaded only in app mode — see components/app/AppChrome.js.
export const AppGuideHeader = dynamic(() => import('./AppGuideHeader'));
