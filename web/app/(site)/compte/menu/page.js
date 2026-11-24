import Link from '@/components/LocaleLink';
import {
  Bell, BellRing, Building2, CalendarCheck, ChevronRight, Inbox, LogOut, MessageCircle, Sparkles, BarChart3, User, Users,
} from 'lucide-react';
import LanguageToggle from '@/components/LanguageToggle';
import CurrencyToggle from '@/components/CurrencyToggle';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { getPortalCounts, getPortalCustomer } from '@/lib/customerPortal';
import { formatPhoneDisplay } from '@/lib/phone';
import { logoutAction } from '../actions';
import AppAvatar from '@/components/app/AppAvatar';
import AppLegalLinks from '@/components/app/AppLegalLinks';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

const FAQ = ['visit', 'whatsapp', 'costs', 'alerts'];

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('appShell.account.title'), robots: { index: false } };
}


function Row({ href, icon: Icon, label, meta = null }) {
  return (
    <li>
      <Link href={href} className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-canvas-alt">
        <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 flex-none text-blue" aria-hidden="true" />
        <span className="flex-1 text-[0.9375rem] font-medium text-ink">{label}</span>
        {meta !== null ? <span className="u-tabular text-[0.8125rem] text-ink-45">{meta}</span> : null}
        <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 flex-none text-ink-45" aria-hidden="true" />
      </Link>
    </li>
  );
}

function Group({ title = null, children }) {
  return (
    <section>
      {title ? <h2 className="mb-2 px-1 text-[0.8125rem] font-semibold text-ink-45">{title}</h2> : null}
      <ul className="divide-y divide-line overflow-hidden rounded-card bg-surface shadow-[var(--shadow-card)]">{children}</ul>
    </section>
  );
}

/**
 * The app's Account tab (the app design's "Account", 2026-11-11), also the
 * place the website's hamburger menu used to hold: the customer's spaces,
 * services, language and currency, the way in for agents, sign out.
 *
 * Public on purpose (middleware PUBLIC_COMPTE_PATHS): signed out it offers
 * sign-in and account creation. Counts are real (getPortalCounts); a count
 * the engine could not give is left out, never shown as 0.
 */
export default async function AccountMenuPage() {
  const t = await getT();
  const portal = await getPortalCustomer().catch(() => null);
  const counts = portal ? await getPortalCounts(portal.customerId).catch(() => null) : null;
  const name = portal?.customer?.full_name?.trim() || null;
  const phone = portal?.customer?.phone ? formatPhoneDisplay(portal.customer.phone) : null;

  return (
    <div className="min-h-full bg-canvas-alt">
    <div className="mx-auto max-w-lg space-y-6 px-4 pb-8 pt-6">
      {portal ? (
        <h1 className="text-[1.75rem] font-extrabold tracking-tight text-ink">{t('appShell.account.title')}</h1>
      ) : null}

      {portal ? (
        <div className="flex items-center gap-4">
          <AppAvatar name={name} size="lg" />
          <div className="min-w-0">
            {name ? <p className="truncate text-[1.0625rem] font-bold text-ink">{name}</p> : null}
            {phone ? <p className="u-tabular text-[0.875rem] text-ink-45">{phone}</p> : null}
          </div>
        </div>
      ) : (
        <section className="rounded-card bg-surface shadow-[var(--shadow-card)] p-5">
          <h1 className="u-title-hero text-ink">{t('appShell.account.guestTitle')}</h1>
          <p className="mt-2 text-[0.9375rem] text-ink-70">{t('appShell.account.guestText')}</p>
          <div className="mt-5 space-y-2.5">
            <Link
              href="/compte/connexion"
              className="u-press flex h-12 items-center justify-center rounded-xl bg-blue text-[0.9375rem] font-semibold text-white"
            >
              {t('appShell.account.signIn')}
            </Link>
            <Link
              href="/compte/inscription"
              className="u-press flex h-12 items-center justify-center rounded-xl border border-ink text-[0.9375rem] font-semibold text-ink"
            >
              {t('appShell.account.signUp')}
            </Link>
          </div>
          <p className="mt-4 text-center text-[0.8125rem] text-ink-45">
            {t('appShell.account.agentPrompt')}{' '}
            <Link href="/compte/agent/connexion" className="font-semibold text-blue">
              {t('appShell.account.agentLogin')}
            </Link>
          </p>
        </section>
      )}

      {portal ? (
        <Group title={t('appShell.account.yourSpace')}>
          <Row href="/compte/client/parametres" icon={User} label={t('appShell.account.profile')} />
          <Row href="/compte/client/visites" icon={CalendarCheck} label={t('appShell.account.visits')} meta={counts?.viewings ?? null} />
          <Row href="/compte/client/demandes" icon={Inbox} label={t('appShell.account.requests')} meta={counts?.inquiries ?? null} />
          <Row href="/compte/client/messages" icon={MessageCircle} label={t('appShell.account.messages')} />
          <Row href="/compte/client/notifications" icon={Bell} label={t('appShell.account.notifications')} />
          <Row href="/compte/client/alertes" icon={BellRing} label={t('appShell.account.alerts')} meta={counts?.alerts ?? null} />
        </Group>
      ) : null}

      <Group title={t('appShell.account.services')}>
        <Row href="/trouver-pour-moi" icon={Sparkles} label={t('appShell.account.find')} />
        <Row href="/combien-coute" icon={BarChart3} label={t('appShell.account.prices')} />
        <Row href="/agents" icon={Users} label={t('appShell.account.agencies')} />
      </Group>

      {/* The questions the app is asked most, answered with what it really does. */}
      <section>
        <h2 className="mb-2 px-1 text-[0.8125rem] font-semibold text-ink-45">{t('appShell.faq.title')}</h2>
        <Accordion type="single" collapsible className="rounded-card bg-surface shadow-[var(--shadow-card)] px-4">
          {FAQ.map((key) => (
            <AccordionItem key={key} value={key}>
              <AccordionTrigger>{t(`appShell.faq.items.${key}.q`)}</AccordionTrigger>
              <AccordionContent>{t(`appShell.faq.items.${key}.a`)}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      <section>
        <h2 className="mb-2 px-1 text-[0.8125rem] font-semibold text-ink-45">{t('appShell.account.preferences')}</h2>
        <div className="divide-y divide-line rounded-card bg-surface shadow-[var(--shadow-card)]">
          <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
            <span className="text-[0.9375rem] font-medium text-ink">{t('appShell.account.language')}</span>
            <LanguageToggle />
          </div>
          <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
            <span className="text-[0.9375rem] font-medium text-ink">{t('appShell.account.currency')}</span>
            <CurrencyToggle />
          </div>
        </div>
      </section>

      <Link href="/compte/agent" className="u-press flex items-center gap-3 rounded-card bg-blue-deep p-4 text-white">
        <Building2 strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6 flex-none" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] font-bold">{t('appShell.account.publishTitle')}</span>
          <span className="block text-[0.8125rem] text-white/80">{t('appShell.account.publishText')}</span>
        </span>
        <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 flex-none" aria-hidden="true" />
      </Link>

      {portal ? (
        <form action={logoutAction}>
          <button
            type="submit"
            className="u-press flex h-12 w-full items-center justify-center gap-2 rounded-card bg-surface shadow-[var(--shadow-card)] text-[0.9375rem] font-semibold text-danger"
          >
            <LogOut strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
            {t('appShell.account.signOut')}
          </button>
        </form>
      ) : null}

      {/* Help, privacy policy, terms: the stores check they can be reached in the app. */}
      <AppLegalLinks />
    </div>
    </div>
  );
}
