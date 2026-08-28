'use server';

import { redirect } from 'next/navigation';
import { normalizeCongoPhone } from '@/lib/phone';
import { createLead } from '@/lib/adminApi';
import { getAgentProfile } from '@/lib/agencies';

/**
 * "Demandez ce bien à cet agent" — a real visitor-initiated lead, written to
 * the engine's real `leads` table (same table/shape every other lead
 * already uses — buyer-conversation tool calls, etc.), not a separate
 * fabricated mechanism. Distinct from Phase 3A's original exclusion (a
 * generic "list your property with us" valuation form) — this is addressed
 * to one specific agent, from a visitor who already found their profile.
 */
export async function submitInquiryAction(agentId, formData) {
  const name = String(formData.get('name') || '').trim();
  const phone = normalizeCongoPhone(String(formData.get('phone') || ''));
  const message = String(formData.get('message') || '').trim();

  // The form's "Type de bien" and "Budget" selects are real answers, but the
  // engine's leads table has no structured column for either as submitted
  // here (transaction_type/price_min/price_max are set by the WhatsApp
  // assistant from parsed conversation, not free-form web input). Folding
  // them into requirements_summary keeps them where the agent actually
  // reads them — the lead body on their dashboard — instead of dropping two
  // answers the visitor deliberately gave.
  const propertyType = String(formData.get('property_type') || '').trim();
  const budget = String(formData.get('budget') || '').trim();
  const summary = [
    propertyType && `Type : ${propertyType}`,
    budget && `Budget : ${budget}`,
    message,
  ]
    .filter(Boolean)
    .join('\n');

  if (!phone) {
    redirect(`/agents/${agentId}?inquiry_error=phone`);
  }

  const agent = await getAgentProfile(agentId);
  if (!agent) {
    redirect(`/agents/${agentId}?inquiry_error=1`);
  }

  const agentName = [agent.first_name, agent.last_name].filter(Boolean).join(' ') || agent.username;

  try {
    await createLead({
      waId: phone,
      name: name || null,
      source: 'agent-profile-inquiry',
      propertyId: null,
      assignedAgent: agentName || null,
      requirementsSummary: summary || null,
    });
  } catch (err) {
    console.error(`[agents/${agentId}] inquiry lead creation failed: ${err.message}`);
    redirect(`/agents/${agentId}?inquiry_error=1`);
  }

  redirect(`/agents/${agentId}?inquiry_sent=1`);
}
