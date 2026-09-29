import PrintSheetPage from '@/components/print/PrintSheetPage';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('agent.print.sheetMetaTitle'), robots: { index: false, follow: false } };
}

/** One-page technical sheet, complete or ?variant=neutre — see components/print/ListingTechSheet.js. */
export default function ListingTechSheetPage({ params, searchParams }) {
  return <PrintSheetPage params={params} searchParams={searchParams} medium="fiche" />;
}
