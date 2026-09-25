import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import ProjectDetailView from '@/components/projects/ProjectDetailView';
import { getPublicProjectById, projectCover } from '@/lib/developments';
import { idFromSlug } from '@/lib/developmentRules';
import { projectKindLabel, projectLocationLine } from '@/lib/projectView';
import { getT } from '@/lib/i18n/server';

const getProject = cache(async (slug) => {
  const id = idFromSlug(slug);
  return id ? getPublicProjectById(id) : null;
});

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const project = await getProject(slug);
  if (!project) return {};
  const t = await getT();
  const where = projectLocationLine(project);
  const title = `${project.name}${where ? ` — ${where}` : ''} | Lukka Place`;
  const description = (project.description || t('projects.meta.detailFallback', { name: project.name, kind: projectKindLabel(project, t) }))
    .replace(/\s+/g, ' ').slice(0, 160);
  const cover = projectCover(project);
  return {
    title,
    description,
    alternates: { canonical: `/projets/${project.slug}` },
    openGraph: { title: project.name, description, type: 'website', images: cover ? [{ url: cover.src }] : undefined },
    twitter: { card: cover ? 'summary_large_image' : 'summary', title: project.name, description, images: cover ? [cover.src] : undefined },
  };
}

/**
 * A project page: a building (off-plan or delivered) or a plot sold in lots.
 * Two columns from lg (content | contact rail, sticky); on a phone the
 * contact card comes after the content and a fixed "Contacter" bar jumps to
 * it, so the form is rendered once.
 */
export default async function ProjectPage({ params, searchParams }) {
  const { slug } = await params;
  const sp = await searchParams;
  const project = await getProject(slug);
  if (!project) notFound();
  // Old slug after a rename: the id still resolves, send them to the current URL.
  if (project.slug !== slug) permanentRedirect(`/projets/${project.slug}`);

  const interest = typeof sp.interest === 'string' ? sp.interest : '';
  const sent = sp.enquiry_sent === '1';
  const error = typeof sp.enquiry_error === 'string' ? sp.enquiry_error : null;
  return <ProjectDetailView project={project} interest={interest} sent={sent} error={error} />;
}

