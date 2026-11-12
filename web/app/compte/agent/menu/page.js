import Link from 'next/link';
import {
  BadgeCheck, BarChart3, Bell, Building2, ChevronRight, ClipboardCheck, Globe, LogOut, MessageCircle, Search, SlidersHorizontal,
} from 'lucide-react';
import LanguageToggle from '@/components/LanguageToggle';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { getFeatureFlags } from '@/lib/siteSettings';
import { countUnread } from '@/lib/chat';
import { countUnreadNotifications } from '@/lib/pushNotifications';
import { formatPhoneDisplay } from '@/lib/phone';
import { agentLogoutAction } from '../actions';
import AppAvatar from '@/components/app/AppAvatar';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('agent.appMenu.title'), robots: { index: false } };
}

const VERIFIED_LEVELS = new Set(['verified', 'agency_partner']);


function Row({ href, icon: Icon, label, count = 0 }) {
  return (
    <li>
      <Link href={href} className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-canvas-alt">
        <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 flex-none text-blue" aria-hidden="true" />
        <span className="flex-1 text-[0.9375rem] font-medium text-ink">{label}</span>
        {count > 0 ? (
          <span className="u-tabular rounded-full bg-blue px-2 py-0.5 text-[0.75rem] font-bold text-white">{count > 99 ? '99+' : count}</span>
        ) : null}
        <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 flex-none text-ink-45" aria-hidden="true" />
      </Link>
    </li>
  );
}

function Group({ title, children }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-[0.8125rem] font-semibold text-ink-45">{title}</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">{children}</ul>
    </section>
  );
}

/**
 * The agent's Compte tab in the app (the app design's "Lister account"):
 * who is signed in, everything the five tabs do not carry (messages,
 * alerts, settings, subscription…), the language, the way over to
 * searching for a home, and sign out. Behind the agent layout's session
 * check like every /compte/agent page. Counts are real (chat, app alerts);
 * the verified mark is shown only for a level the team granted.
 */
export default async function AgentAppMenuPage() {
  const t = await getT();
  const agentId = await getCurrentAgentId();
  const [context, features, messages, alerts] = await Promise.all([
    getAgentDashboardContext(agentId),
    getFeatureFlags(),
    countUnread({ role: 'agent', id: agentId }).then((c) => c.messages).catch(() => 0),
    countUnreadNotifications('agent', agentId).catch(() => 0),
  ]);
  const agent = context?.agent || {};
  const name = context?.displayName || null;
  const agency = agent.agency_name || agent.vendor_name || null;
  const phone = agent.phone ? formatPhoneDisplay(agent.phone) : null;
  const verified = VERIFIED_LEVELS.has(agent.verification_level);

  return (
    <div className="min-h-full bg-canvas-alt">
      <div className="mx-auto max-w-lg space-y-6 px-4 pb-8 pt-6">
        <h1 className="text-[1.75rem] font-extrabold tracking-tight text-ink">{t('agent.appMenu.title')}</h1>

        <div className="flex items-center gap-4">
          <AppAvatar name={name || agency} src={agent.image} size="lg" verified={verified} verifiedLabel={t('agent.appMenu.verified')} />
          <div className="min-w-0 flex-1">
            {name ? <p className="truncate text-[1.0625rem] font-bold text-ink">{name}</p> : null}
            {agency && agency !== name ? <p className="truncate text-[0.875rem] text-ink-70">{agency}</p> : null}
            {phone ? <p className="u-tabular text-[0.8125rem] text-ink-45">{phone}</p> : null}
            {verified ? <p className="mt-0.5 text-[0.8125rem] font-semibold text-green-ink">{t('agent.appMenu.verified')}</p> : null}
          </div>
        </div>

        <Group title={t('agent.appMenu.activity')}>
          <Row href="/compte/agent/messages" icon={MessageCircle} label={t('agent.appMenu.messages')} count={messages} />
          <Row href="/compte/agent/alertes" icon={Bell} label={t('agent.appMenu.alerts')} count={alerts} />
          <Row href="/compte/agent/point" icon={ClipboardCheck} label={t('agent.appMenu.point')} />
          <Row href="/compte/agent" icon={BarChart3} label={t('agent.appMenu.dashboard')} />
          {features.agentProjects ? <Row href="/compte/agent/projets" icon={Building2} label={t('agent.appMenu.projects')} /> : null}
        </Group>

        <Group title={t('agent.appMenu.account')}>
          <Row href="/compte/agent/parametres" icon={SlidersHorizontal} label={t('agent.appMenu.settings')} />
          {features.agentSubscriptions ? <Row href="/compte/agent/abonnement" icon={BadgeCheck} label={t('agent.appMenu.subscription')} /> : null}
          <Row href={`/agents/${agentId}`} icon={Globe} label={t('agent.appMenu.publicPage')} />
        </Group>

        <section>
          <h2 className="mb-2 px-1 text-[0.8125rem] font-semibold text-ink-45">{t('agent.appMenu.preferences')}</h2>
          <div className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
            <span className="text-[0.9375rem] font-medium text-ink">{t('agent.appMenu.language')}</span>
            <LanguageToggle />
          </div>
        </section>

        <Link href="/" className="u-press flex items-center gap-3 rounded-2xl bg-blue-deep p-4 text-white">
          <Search strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6 flex-none" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-[0.9375rem] font-bold">{t('agent.appMenu.searchTitle')}</span>
            <span className="block text-[0.8125rem] text-white/80">{t('agent.appMenu.searchText')}</span>
          </span>
          <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 flex-none" aria-hidden="true" />
        </Link>

        <form action={agentLogoutAction}>
          <button
            type="submit"
            className="u-press flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface text-[0.9375rem] font-semibold text-danger"
          >
            <LogOut strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
            {t('agent.appMenu.signOut')}
          </button>
        </form>
      </div>
    </div>
  );
}
