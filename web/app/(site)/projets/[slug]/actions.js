'use server';

import { redirect } from 'next/navigation';
import { phoneFromForm } from '@/lib/phone';
import { createProjectEnquiry } from '@/lib/adminApi';
import { getPublicProjectById } from '@/lib/developments';

/**
 * The enquiry form on a project page. The project is re-read under the public
 * gate here AND by the engine (services/projectEnquiry.js), so a crafted id
 * for an unpublished project creates nothing. The engine stamps the lead with
 * the developer's account (their Demandes inbox) and alerts developer + desk.
 */
export async function submitProjectEnquiryAction(projectId, formData) {
  const project = await getPublicProjectById(projectId);
  if (!project) redirect('/projets');
  const back = `/projets/${project.slug}`;

  const phone = phoneFromForm(formData);
  if (!phone) redirect(`${back}?enquiry_error=phone#contact`);
  const name = String(formData.get('name') || '').trim().slice(0, 120);
  const message = String(formData.get('message') || '').trim().slice(0, 800);
  const interest = String(formData.get('interest') || '').slice(0, 40);

  try {
    await createProjectEnquiry({
      developmentId: project.id,
      waId: phone,
      name: name || null,
      interest,
      message: message || null,
    });
  } catch (err) {
    console.error(`[projets/${project.id}] enquiry failed: ${err.message}`);
    redirect(`${back}?enquiry_error=1#contact`);
  }
  redirect(`${back}?enquiry_sent=1#contact`);
}
