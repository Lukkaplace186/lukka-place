import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDemoAccount } from '@/lib/demoAccounts';
import { getT } from '@/lib/i18n/server';
import WhatsAppHistory from '../../WhatsAppHistory';

export const dynamic = 'force-dynamic';

/**
 * Every message the demo pair "received": what the engine recorded instead of
 * sending (services/demoAccounts.js). Messages that would have gone to a real
 * number during a demo action (the desk, an agency) are recorded here too,
 * each headed "[Démo — non envoyé à +…]".
 */
export default async function AdminDemoMessagesPage({ params }) {
  const { id } = await params;
  const t = await getT();
  const pair = await getDemoAccount(id);
  if (!pair) notFound();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/admin/demo" className="u-micro-strong text-ink-45 hover:text-ink">{t('admin.demo.back')}</Link>
        <h1 className="u-title-page mt-2 text-ink">{t('admin.demo.messagesTitle', { label: pair.label })}</h1>
        <p className="u-micro mt-1 max-w-3xl text-ink-45">{t('admin.demo.messagesHint')}</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h2 className="u-title-sub text-ink">{t('admin.demo.customerSide')}</h2>
          <WhatsAppHistory waId={pair.customerPhone} limit={100} />
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="u-title-sub text-ink">{t('admin.demo.agentSide')}</h2>
          <WhatsAppHistory waId={pair.agentPhone} limit={100} />
        </div>
      </div>
    </div>
  );
}
