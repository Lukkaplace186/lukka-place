import { cn } from '@/lib/utils';

/**
 * The agent's messaging area fills the screen beside the portal's sidebar:
 * full height on a computer, the height above the fixed tab bar on a phone
 * (the agent layout already pads 4rem for it). Columns scroll on their own.
 */
export function AgentMessagesFrame({ children }) {
  return <div className="flex h-[calc(100dvh-4rem)] min-h-0 w-full lg:h-screen">{children}</div>;
}

/** The left column: page title, then the inbox in its column variant. */
export function AgentMessagesListColumn({ t, className = '', children }) {
  return (
    <section aria-label={t('chat.title')} className={cn('flex min-h-0 flex-none flex-col border-r border-line bg-surface', className)}>
      <header className="flex flex-col gap-1 px-4 pt-5 pb-3">
        <h1 className="u-title-page text-ink">{t('chat.title')}</h1>
        <p className="text-[0.8125rem] text-ink-45">{t('chat.agent.lead')}</p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}
