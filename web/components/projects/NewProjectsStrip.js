import Link from 'next/link';
import ProjectCard from '@/components/projects/ProjectCard';
import { getRecentProjects } from '@/lib/developments';
import { memo } from '@/lib/memo';
import { getT } from '@/lib/i18n/server';

/**
 * "Nouveaux projets" on the homepage: the most recently approved public
 * projects, at most six. Renders nothing when there is none — an empty
 * shelf would advertise an empty section. Read once a minute (lib/memo.js);
 * a failure hides the strip rather than the homepage.
 */
export default async function NewProjectsStrip() {
  const projects = await memo('projects:recent', 60_000, () => getRecentProjects(6)).catch(() => []);
  if (!projects.length) return null;
  const t = await getT();
  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="u-eyebrow text-blue-deep">{t('projects.home.eyebrow')}</p>
          <h2 className="u-title-section text-ink">{t('projects.home.title')}</h2>
        </div>
        <Link href="/projets" className="shrink-0 text-sm font-semibold text-blue-deep hover:underline">{t('projects.home.all')}</Link>
      </div>
      <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
        {projects.map((project) => (
          <div key={project.id} className="w-[85%] shrink-0 snap-start sm:w-auto">
            <ProjectCard project={project} />
          </div>
        ))}
      </div>
    </section>
  );
}
