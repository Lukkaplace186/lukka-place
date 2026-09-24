'use server';

import { redirect } from 'next/navigation';
import { phoneFromForm } from '@/lib/phone';
import { createLead } from '@/lib/adminApi';

/**
 * "Présenter mon projet" on /promoteurs. Recorded as a lead with source
 * 'developer-application' — no commune, so the engine never dispatches it to
 * agencies; the team picks it up on /admin/leads and creates the project on
 * /admin/projets once they have spoken to the developer.
 */
export async function submitDeveloperApplicationAction(formData) {
  const phone = phoneFromForm(formData);
  if (!phone) redirect('/promoteurs?error=phone#presenter');
  const name = String(formData.get('name') || '').trim().slice(0, 120);
  const company = String(formData.get('company') || '').trim().slice(0, 140);
  const project = String(formData.get('project') || '').trim().slice(0, 1000);
  const kind = ['building', 'off_plan', 'land'].includes(formData.get('kind')) ? formData.get('kind') : 'building';
  const kindText = { building: 'Immeuble livré', off_plan: 'Projet sur plan', land: 'Terrain / lotissement' }[kind];

  try {
    await createLead({
      waId: phone,
      name: name || null,
      source: 'developer-application',
      requirementsSummary: [
        `Candidature promoteur — ${kindText}`,
        company ? `Société : ${company}` : null,
        project || null,
      ].filter(Boolean).join('\n'),
    });
  } catch (err) {
    console.error(`[promoteurs] application failed: ${err.message}`);
    redirect('/promoteurs?error=1#presenter');
  }
  redirect('/promoteurs?sent=1#presenter');
}
