import Link from 'next/link';
import { Building2, ChevronRight } from 'lucide-react';
import { getAgentProjects } from '@/lib/developments';
import { availabilityLine } from '@/lib/projectView';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

/**
 * Overview card for a developer: their projects and what is left in each.
 * Renders nothing for an agent with no project, which is almost everyone —
 * the agent portal's four-section navigation stays as it is.
 */
export default async function AgentProjectsCard({ agentId }) {
  const projects = await getAgentProjects(agentId).catch(() => []);
  if (!projects.length) return null;
  const t = await getT();

  return (
    <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="u-title-card inline-flex items-center gap-2 text-ink">
          <Building2 strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 text-blue-deep" />
          {t('agent.projects.cardTitle')}
        </h2>
        <Link href="/compte/agent/projets" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-deep hover:underline">
          {t('agent.projects.manage')}
          <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        </Link>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {projects.map((project) => (
          <li key={project.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="font-semibold text-ink">{project.name}</span>
            <span className="text-ink-70">
              {availabilityLine(project, t) || '—'}
              {project.approve_status !== 1 ? ` · ${t('agent.projects.draft')}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
