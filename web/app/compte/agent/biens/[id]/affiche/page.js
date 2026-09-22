import PrintSheetPage from '@/components/print/PrintSheetPage';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('agent.print.posterMetaTitle'), robots: { index: false, follow: false } };
}

/** A4 window poster with a QR code — see components/print/ListingPoster.js. */
export default function ListingPosterPage({ params }) {
  return <PrintSheetPage params={params} medium="poster" />;
}
