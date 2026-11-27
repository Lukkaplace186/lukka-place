'use client';

import dynamic from 'next/dynamic';

// The app's home top (home page), loaded only in app mode — see components/app/AppChrome.js.
export const AppHomeTop = dynamic(() => import('../AppHomeTop'));
