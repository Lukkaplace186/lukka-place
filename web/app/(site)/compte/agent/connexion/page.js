import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentAgentId, getRememberedAgentPhone } from '@/lib/agentSession';
import { getAgentById } from '@/lib/agents';
import { agentLoginAction } from './actions';
import AgentLoginForm from './AgentLoginForm';
import { splitPhone } from '@/lib/phone';
import { getRequestCountry } from '@/lib/requestCountry';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('auth.agentLoginMetaTitle'), robots: { index: false, follow: false } };
}

/**
 * Agent sign-in. The form (AgentLoginForm.js) opens on the number this device
 * last signed in with; a refusal keeps what was typed (2026-11-08).
 */
export default async function AgentLoginPage({ searchParams }) {
  const t = await getT();
  const country = await getRequestCountry();
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const reset = params.reset === '1';
  const next = typeof params.next === 'string' ? params.next : '/compte/agent';
  // The number that last signed in on this device (lib/agentSession.js).
  const remembered = splitPhone(await getRememberedAgentPhone());

  // Already signed in (a menu link, a bookmark, a WhatsApp link that went
  // through here): straight to the page asked for, not the form again. The
  // account must still exist — the dashboard sends a deleted one back here,
  // and redirecting it onwards would loop.
  const signedInAgentId = await getCurrentAgentId();
  if (signedInAgentId && !error && (await getAgentById(signedInAgentId).catch(() => null))) {
    redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/compte/agent');
  }

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 u-lift sm:p-8">
        <h1 className="u-title-section text-ink">{t('agent.nav.eyebrow')}</h1>
        <p className="mt-1 text-sm text-ink-45">{t('auth.agentLoginLead')}</p>

        {reset && (
          <p className="mt-4 text-sm text-green-deep" role="status">
            {t('auth.passwordReset')}
          </p>
        )}

        <AgentLoginForm
          action={agentLoginAction}
          next={next}
          error={error}
          defaultCountry={remembered.country || country}
          defaultPhone={remembered.country ? remembered.national : ''}
          submitLabel={t('admin.login.submit')}
        />

        <p className="mt-5 text-center text-sm text-ink-45">
          {t('auth.agentNoAccountYet')}{' '}
          <Link
            href={`/compte/agent/inscription?next=${encodeURIComponent(next)}`}
            className="font-semibold text-blue-deep hover:underline"
          >
            {t('common.actions.signup')}
          </Link>
        </p>
      </div>
    </div>
  );
}
