import { notFound } from 'next/navigation';
import ProjectDetailView from '@/components/projects/ProjectDetailView';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentProject } from '@/lib/developments';

export const metadata = { robots: { index: false, follow: false } };

/**
 * A developer's own project, in any state, rendered exactly as the public
 * page will render it — with a "Brouillon" banner and no enquiry form. Only
 * the owner's session opens it (getAgentProject scopes by agent_id in SQL);
 * anybody else gets the same 404 as a missing id, so a draft's existence is
 * never confirmed. Units are shown as a buyer will see them: pending units
 * are counted nowhere and listed nowhere until the team approves them.
 */
export default async function ProjectPreviewPage({ params }) {
  const { id } = await params;
  const agentId = await getCurrentAgentId();
  if (!agentId) notFound();
  const project = await getAgentProject(agentId, id);
  if (!project) notFound();
  const asPublic = {
    ...project,
    unit_types: (project.unit_types || []).map((type) => ({
      ...type,
      live_units: (type.live_units || []).filter((u) => Number(u.approve_status) === 1),
    })),
  };
  return <ProjectDetailView project={asPublic} preview />;
}
