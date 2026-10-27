import { Download, Gift } from 'lucide-react';
import { ICON_STROKE_WIDTH, SITE_URL } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { getAgentReferralStats } from '@/lib/partners';
import { getAgentCreditSummary } from '@/lib/referralCredits';
import { ACTIVATION_WINDOW_DAYS, REFERRAL_CREDIT } from '@/lib/referralRules';
import { partnerLinks } from '@/lib/partnerRules';
import { buildWhatsAppShareLink } from '@/lib/whatsapp';
import { frNumber } from '@/lib/format';
import CopyLinkButton from './CopyLinkButton';
import { WhatsAppIcon } from './WhatsAppCTA';

/**
 * "Mes parrainages" (growth plan item 16): the agent's own invite link
 * (/i/<code>, lib/partnerRules.js), a QR code to print, and what their links
 * have brought — clicks, customer accounts, verified numbers. The same code
 * rides on every listing they share (lib/listingShareCopy.js), so sharing as
 * usual already counts here.
 *
 * Money (2026-10-27, owner decision): $1 per ACTIVATED customer
 * (lib/referralRules.js — verified number + one real action within 14 days),
 * shown as waiting / approved / paid from the agent's own credits, and the
 * last customers by first name only. The invite message is French whatever
 * the dashboard language — the agent's customers read it.
 *
 * Renders nothing before the migration, or when the database cannot answer.
 */
const INVITE_MESSAGE = 'Créez votre compte gratuit sur Lukka Place pour recevoir les nouveaux biens à louer et à vendre à Kinshasa : ';

export default async function AgentReferralCard({ agentId }) {
  const stats = await getAgentReferralStats(agentId);
  if (!stats) return null;
  const credits = await getAgentCreditSummary(agentId).catch(() => null);
  const t = await getT();
  const links = partnerLinks(stats.code, { siteUrl: SITE_URL });

  const figures = [
    { label: t('agent.referrals.clicks'), value: stats.clicks, hint: t('agent.referrals.last30', { n: frNumber(stats.clicks30d) }) },
    { label: t('agent.referrals.accounts'), value: stats.accounts },
    { label: t('agent.referrals.activated'), value: credits ? credits.activated : stats.verified },
  ];
  const usd = (value) => `${frNumber(value)} $`;

  return (
    <section aria-labelledby="agent-referrals-title" className="u-card flex flex-col gap-4 rounded-card bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-tint text-blue-deep">
          <Gift strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="agent-referrals-title" className="u-title-card text-ink">{t('agent.referrals.title')}</h2>
          <p className="u-micro mt-0.5 text-ink-70">{t('agent.referrals.lead')}</p>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2">
        {figures.map((figure) => (
          <div key={figure.label} className="rounded-lg bg-canvas-alt p-3">
            <dt className="u-micro text-ink-45">{figure.label}</dt>
            <dd className="u-stat text-ink">{frNumber(figure.value)}</dd>
            {figure.hint ? <dd className="u-micro text-ink-45">{figure.hint}</dd> : null}
          </div>
        ))}
      </dl>

      {credits ? (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span className="u-micro text-ink-70">{t('agent.referrals.waiting')} <strong className="u-tabular text-ink">{usd(credits.pendingUsd)}</strong></span>
            <span className="u-micro text-ink-70">{t('agent.referrals.approved')} <strong className="u-tabular text-ink">{usd(credits.approvedUsd)}</strong></span>
            <span className="u-micro text-ink-70">{t('agent.referrals.paid')} <strong className="u-tabular text-ink">{usd(credits.paidUsd)}</strong></span>
          </div>
          {credits.recent.length ? (
            <ul className="flex flex-wrap gap-1.5" aria-label={t('agent.referrals.recent')}>
              {credits.recent.map((entry, index) => (
                <li key={`${entry.createdAt}-${index}`} className="u-micro rounded-full bg-canvas-alt px-2.5 py-1 text-ink-70">
                  {entry.firstName || t('agent.referrals.someone')}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="u-micro text-ink-45">
            {t('agent.referrals.rule', { amount: usd(REFERRAL_CREDIT.amount), days: ACTIVATION_WINDOW_DAYS })}
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="u-micro text-ink-45">
          {t('agent.referrals.yourCode')} <span className="u-ref font-bold text-ink">{stats.code}</span>
        </div>
        <div className="u-micro break-all rounded-lg bg-canvas-alt px-3 py-2 text-ink-70">{links.invite}</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <CopyLinkButton
            url={links.invite}
            label={t('agent.referrals.copy')}
            className="u-press inline-flex h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold text-ink ring-1 ring-inset ring-line hover:bg-canvas-alt"
          />
          <a
            href={buildWhatsAppShareLink(INVITE_MESSAGE + links.invite)}
            target="_blank"
            rel="noopener noreferrer"
            className="u-press inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-green px-3 text-sm font-bold text-white hover:bg-green-deep"
          >
            <WhatsAppIcon className="h-[1.125rem] w-[1.125rem]" />
            {t('agent.referrals.share')}
          </a>
          <a
            href="/compte/agent/parrainage/qr"
            className="u-press inline-flex h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold text-ink ring-1 ring-inset ring-line hover:bg-canvas-alt"
          >
            <Download strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
            {t('agent.referrals.qr')}
          </a>
        </div>
        <p className="u-micro text-ink-45">{t('agent.referrals.hint')}</p>
      </div>
    </section>
  );
}
