import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { createDocumentSignedUrl, getVerificationDocument } from '@/lib/agentVerification';

/**
 * GET /admin/verifications/documents/:id — opens one identity / RCCM document.
 *
 * The file sits in a PRIVATE bucket. This route checks the team member may act
 * on agents, records that they opened it, and redirects to a signed URL that
 * expires in five minutes. The URL is never stored and never rendered into a
 * page, so a copied link or a cached HTML page cannot hand an ID card to
 * anyone later. Every opening is audited because these are the most sensitive
 * files the platform holds.
 */
export const dynamic = 'force-dynamic';

const SIGNED_URL_SECONDS = 300;

export async function GET(request, { params }) {
  let session;
  try {
    session = await requireAdmin('agents.manage');
  } catch {
    return new Response('Forbidden', { status: 403 });
  }

  const { id } = await params;
  const doc = await getVerificationDocument(Number.parseInt(id, 10));
  if (!doc) return new Response('Not found', { status: 404 });

  let url;
  try {
    url = await createDocumentSignedUrl(doc.storage_path, SIGNED_URL_SECONDS);
  } catch (err) {
    console.error(`[admin/verifications] signed URL failed for document #${doc.id}: ${err.message}`);
    return new Response('Document unavailable', { status: 502 });
  }

  await recordAudit(session, {
    action: 'verification.document.viewed',
    entityType: 'agent',
    entityId: doc.agent_id,
    details: { documentId: Number(doc.id), docType: doc.doc_type },
  });

  return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' } });
}
