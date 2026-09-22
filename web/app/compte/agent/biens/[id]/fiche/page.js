import PrintSheetPage from '@/components/print/PrintSheetPage';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('agent.print.sheetMetaTitle'), robots: { index: false, follow: false } };
}

/** Two-page technical sheet — see components/print/ListingTechSheet.js. */
export default function ListingTechSheetPage({ params }) {
  return <PrintSheetPage params={params} medium="fiche" />;
}
