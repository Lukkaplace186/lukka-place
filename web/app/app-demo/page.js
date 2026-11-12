import { notFound } from 'next/navigation';
import AppDemoBoard from './AppDemoBoard';
import { cachedFeaturedListings, cachedPopularCommunes } from '@/lib/listingsCached';
import ComponentsShowcase from './ComponentsShowcase';
import AppMotion from '@/components/app/AppMotion';
import { feedLocationLine, listingImages } from '@/lib/listingView';
import { appSerif } from '@/lib/appFont';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lukka Place — démo de l’app', robots: { index: false, follow: false } };

/**
 * /app-demo — every screen of the store app side by side, in phone frames,
 * for working on the app's design (2026-11-12, owner request). LOCAL ONLY:
 * a production build answers 404, so it never reaches lukkaplace.com. Each
 * frame is the real page in app mode on real data; on `next dev` every frame
 * refreshes by itself when the code changes.
 *
 * Screens that need a session (Notifications, the agent space) show the
 * sign-in page until someone signs in inside any frame: the frames share the
 * browser's cookies, so one sign-in serves them all.
 */
export default async function AppDemoPage({ searchParams }) {
  if (process.env.NODE_ENV === 'production') notFound();
  // A real public listing for the listing and booking screens (the newest).
  const [{ data }, communes] = await Promise.all([
    cachedFeaturedListings().catch(() => ({ data: [] })),
    cachedPopularCommunes(6).catch(() => []),
  ]);
  const newest = data?.[0] || null;
  const id = newest?.id ?? null;
  // The components board draws on that same listing: its own photos and place.
  const place = newest ? feedLocationLine(newest) : null;
  const photos = newest ? listingImages(newest).slice(0, 6) : [];
  const showcaseListing = newest
    ? {
        photos,
        place,
        // The shape a shared listing card has in Messagerie (lib/chat.js), from the real row.
        chatCard: {
          id: newest.id,
          image: photos[0] || null,
          category: newest.category_name || null,
          place,
          priceLabel: Number(newest.price) > 0 ? `${Number(newest.price).toLocaleString('fr-FR')} $` : null,
        },
      }
    : null;

  const customer = [
    { label: 'Accueil', href: '/' },
    { label: 'Résultats', href: '/listings?commune=Limete' },
    ...(id
      ? [
          { label: 'Annonce', href: `/listings/${id}` },
          { label: 'Visite · étape 1', href: `/listings/${id}/visite` },
          { label: 'Visite demandée', href: `/listings/${id}/visite?visit_sent=1` },
          { label: 'Visite · erreur', href: `/listings/${id}/visite?visit_error=closed` },
        ]
      : []),
    { label: 'Enregistrés', href: '/favoris' },
    { label: 'Compte', href: '/compte/menu' },
    { label: 'Connexion', href: '/compte/connexion' },
    { label: 'Notifications', href: '/compte/client/notifications', needs: 'client' },
  ];
  const agent = [
    { label: 'Accueil agent', href: '/compte/agent', needs: 'agent' },
    { label: 'Annonces', href: '/compte/agent/biens', needs: 'agent' },
    { label: 'Demandes', href: '/compte/agent/demandes', needs: 'agent' },
    { label: 'Visites', href: '/compte/agent/visites', needs: 'agent' },
    { label: 'Compte agent', href: '/compte/agent/menu', needs: 'agent' },
  ];

  // The app's display serif, so the component samples draw as in the app.
  return (
    <AppMotion>
      <div className={appSerif.variable}>
        <AppDemoBoard
          // ?vue=composants: the building blocks only, without the 15 phone frames.
          groups={(await searchParams)?.vue === 'composants' ? [] : [{ title: 'Clients', screens: customer }, { title: 'Agents', screens: agent }]}
          showcase={<ComponentsShowcase listing={showcaseListing} communes={communes} />}
        />
      </div>
    </AppMotion>
  );
}
