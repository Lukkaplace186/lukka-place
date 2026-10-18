import { redirect } from 'next/navigation';
import { getFeatureFlags } from '@/lib/siteSettings';

// Same noindex as app/(site)/projets/layout.js: the redirect is a client hop.
export async function generateMetadata() {
  return (await getFeatureFlags()).publicProjects ? {} : { robots: { index: false, follow: false } };
}

/** Projets neufs switched off on /admin/settings: the developers' page goes to the listings too. */
export default async function DevelopersLayout({ children }) {
  if (!(await getFeatureFlags()).publicProjects) redirect('/listings');
  return children;
}
