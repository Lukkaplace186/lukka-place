import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getPortalCustomer } from '@/lib/customerPortal';
import { getAccountPhones } from '@/lib/customerPhoneChange';
import { getLead } from '@/lib/adminApi';
import { getT } from '@/lib/i18n/server';
import FollowupAnswers from './FollowupAnswers';
import { answerFollowupAction } from './actions';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('account.followup.metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

/**
 * "Un agent vous a-t-il contacté ?" — where the 24 h follow-up's
 * notification opens (engine services/requestFollowup.js). Only a request
 * made from one of this account's numbers is shown; any other id is a 404,
 * like one that does not exist.
 */
export default async function FollowupPage({ params }) {
  const { id } = await params;
  const t = await getT();
  const session = await getPortalCustomer();
  if (!session) redirect(`/compte/connexion?next=${encodeURIComponent(`/compte/client/suivi/${id}`)}`);
  const leadId = Number.parseInt(String(id), 10);
  if (!Number.isSafeInteger(leadId) || leadId <= 0) notFound();

  let lead = null;
  try {
    ({ lead } = (await getLead(leadId)) || {});
  } catch (err) {
    if (err.status !== 404) console.error(`[compte/client/suivi] lead #${leadId} read failed: ${err.message}`);
  }
  const phones = await getAccountPhones(session.customerId, session.customer.phone);
  const owned = lead && phones.map((p) => String(p).replace(/\D/g, '')).includes(String(lead.wa_id || '').replace(/\D/g, ''));
  if (!owned) notFound();

  const subject = String(lead.requirements_summary || '').trim() || (lead.commune ? t('account.followup.searchIn', { commune: lead.commune }) : null);

  return (
    <div className="mx-auto flex max-w-[34rem] flex-col gap-4">
      <h1 className="u-title-page text-ink">{t('account.followup.title')}</h1>
      <p className="text-[0.9375rem] leading-relaxed text-ink-70">
        {t('account.followup.intro')}
        {subject ? <span className="mt-1 block font-semibold text-ink">{subject}</span> : null}
      </p>
      <FollowupAnswers leadId={leadId} initialAnswer={lead.contact_followup_answer || null} answerAction={answerFollowupAction} />
      <Link href="/compte/client/messages" className="self-start text-[0.875rem] font-bold text-blue-deep">
        {t('account.followup.back')}
      </Link>
    </div>
  );
}
