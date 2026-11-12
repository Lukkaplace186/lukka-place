import { DM_Serif_Display } from 'next/font/google';

/*
 * The app's display serif (the app design, 2026-11-11): the wordmark and the
 * big screen titles only, never UI or data — Plus Jakarta Sans carries the
 * rest, as on the site. Loaded by app/(site)/layout.js in app mode only, and
 * not preloaded: the website never draws it, so it must not cost a visitor a
 * download. `.u-app-serif` (globals.css) reads the variable.
 */
export const appSerif = DM_Serif_Display({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-app-serif',
  display: 'swap',
  preload: false,
});
