'use client';

import dynamic from 'next/dynamic';

/**
 * The store app's own chrome, loaded only where a page is drawn in app mode
 * (lib/appMode.js isAppRequest). 2026-11-22: imported statically by the site
 * layout and the home, listing and commune pages, these pieces put Motion
 * (`motion/react`) and their own code in the first load of EVERY website
 * page, though a website visitor never sees one — measured live, it is most
 * of what stops the public JS from shrinking (web/CLAUDE.md, "Public JS and
 * HTML diet").
 *
 * The split has to happen in a client module: a Server Component that
 * `dynamic()`-imports a Client Component is not code-split (Next 16,
 * docs/01-app/02-guides/lazy-loading.md). Each loader is a separate chunk,
 * fetched only when its component is rendered — in app mode, where the server
 * render also preloads it, so the app shows the same HTML as before. The names
 * are the components' own, so call sites read the same.
 *
 * One loader module per place that draws them: this one for the site layout;
 * AppHomeTopLazy, AppListingChrome and AppGuideHeaderLazy for their pages. A
 * layout's import graph is what tests/unit/i18n-namespaces.test.js reads to
 * know which texts that layout must ship, so it must hold only what it draws.
 */
export const AppTopBar = dynamic(() => import('./AppTopBar'));
export const AppTabBar = dynamic(() => import('../AppTabBar'));
export const AppPullToRefresh = dynamic(() => import('./AppPullToRefresh'));
export const AppMotion = dynamic(() => import('./AppMotion'));
