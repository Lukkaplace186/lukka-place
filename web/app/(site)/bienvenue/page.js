import { getT } from '@/lib/i18n/server';
import { cachedPopularCommunes } from '@/lib/listingsCached';
import AppWelcome from '@/components/app/AppWelcome';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('appShell.welcome.metaTitle'), robots: { index: false, follow: false } };
}

/**
 * The app's first open (GET /app sends here until lp_welcome is set): three
 * questions answered with taps, then the matching listings. The communes
 * offered are the ones with the most live listings, read from the database —
 * never a hardcoded list. Works in a browser too; nothing here needs an account.
 */
export default async function WelcomePage() {
  let communes = [];
  try {
    communes = (await cachedPopularCommunes(8)).map((c) => c.commune).filter(Boolean);
  } catch (err) {
    console.error(`[welcome] popular communes unavailable: ${err.message}`);
  }
  return <AppWelcome communes={communes} />;
}
