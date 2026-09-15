'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentAgentId } from '@/lib/agentSession';
import { submitVerificationDocument } from '@/lib/agentVerification';

/**
 * The agent's "Vérification du compte" upload (/compte/agent/parametres).
 *
 * A plain form action with a redirect, like the other settings cards on that
 * page, so it works without JavaScript on a slow phone. Every check —
 * document type, size, real file format by magic bytes, the pending cap —
 * happens in lib/agentVerification.js; the browser's `accept` attribute is a
 * convenience, not a rule.
 */
export async function uploadVerificationDocumentAction(formData) {
  const agentId = await getCurrentAgentId();
  if (!agentId) redirect('/compte/agent/connexion');

  const result = await submitVerificationDocument(agentId, {
    docType: String(formData.get('doc_type') || ''),
    file: formData.get('document'),
  });

  revalidatePath('/compte/agent/parametres');
  redirect(
    result.ok
      ? '/compte/agent/parametres?saved=verification#verification'
      : `/compte/agent/parametres?verification_error=${encodeURIComponent(result.code)}#verification`,
  );
}
