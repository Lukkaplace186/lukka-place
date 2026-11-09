import Link from 'next/link';
import { notFound } from 'next/navigation';
import StatusCheckBoard from '@/components/statusCheck/StatusCheckBoard';
import { markStatusRequestOpened, resolveStatusRequest } from '@/lib/statusCheck';
import { getStatusBoardItems } from '@/lib/statusCheckItems';

/**
 * "Faites le point sur vos annonces" from the agent's WhatsApp link
 * (services/agentStatusCheck.js → lib/statusCheck.js). No login: the link is
 * the agent's, private, valid 7 days, and can only change the status of
 * their own listings. Never indexed, never cached; an unknown link is a 404
 * that says nothing about why.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return {
    title: 'Faites le point sur vos annonces — Lukka Place',
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function StatusLinkPage({ params }) {
  const { token } = await params;
  const request = await resolveStatusRequest(token);
  if (!request) notFound();

  if (request.expired) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-10 text-center">
        <h1 className="u-title-section text-ink">Ce lien a expiré</h1>
        <p className="text-ink-70">
          Pour mettre vos annonces à jour, ouvrez « Faites le point » depuis votre espace agent. Vous recevrez aussi un nouveau lien au prochain point.
        </p>
        <Link href="/compte/agent/point" className="u-btn-primary u-press bg-blue text-white mx-auto inline-flex min-h-11 items-center rounded-lg px-5 font-bold">
          Ouvrir mon espace agent
        </Link>
      </div>
    );
  }

  await markStatusRequestOpened(request.requestId);
  const items = await getStatusBoardItems(request.agentId);

  return (
    <div className="mx-auto max-w-xl px-3 py-5 sm:px-6 sm:py-8">
      <StatusCheckBoard token={token} items={items} firstName={request.firstName} />
    </div>
  );
}
