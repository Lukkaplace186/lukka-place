import { redirect } from 'next/navigation';
import { getFeatureFlags } from '@/lib/siteSettings';

/** The agent portal's projects switched off on /admin/settings: every page here goes back to the dashboard. */
export default async function AgentProjectsLayout({ children }) {
  if (!(await getFeatureFlags()).agentProjects) redirect('/compte/agent');
  return children;
}
