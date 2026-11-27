import { listDemoAccounts } from '@/lib/demoAccounts';
import { getT } from '@/lib/i18n/server';
import { ErrorNote } from '../LeadRoutingUI';
import { CreateDemoForm, DemoPairCard } from './DemoAccountsClient';

export const dynamic = 'force-dynamic';

/**
 * Demo accounts (lib/demoAccounts.js): a demo customer and a demo agent the
 * team signs into to try the product end to end. What keeps them sealed is
 * listed on the page itself, so whoever uses it knows what they will and will
 * not see.
 */
export default async function AdminDemoPage() {
  const t = await getT();
  let data = { ready: true, rows: [] };
  let loadError = null;
  try {
    data = await listDemoAccounts();
  } catch (err) {
    loadError = err.message;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.demo.title')}</h1>
        <p className="u-micro mt-1 max-w-3xl text-ink-45">{t('admin.demo.subtitle')}</p>
      </div>

      <section className="u-card rounded-card bg-surface p-5">
        <h2 className="u-title-card text-ink">{t('admin.demo.rulesTitle')}</h2>
        <ul className="u-micro mt-2 flex list-disc flex-col gap-1 pl-5 text-ink-70">
          <li>{t('admin.demo.ruleNumbers')}</li>
          <li>{t('admin.demo.ruleMessages')}</li>
          <li>{t('admin.demo.ruleRouting')}</li>
          <li>{t('admin.demo.ruleListings')}</li>
          <li>{t('admin.demo.ruleStats')}</li>
          <li>{t('admin.demo.ruleBrowse')}</li>
        </ul>
      </section>

      {loadError ? <ErrorNote>{t('admin.demo.loadError', { error: loadError })}</ErrorNote> : null}
      {!data.ready ? <ErrorNote>{t('admin.demo.notReady')}</ErrorNote> : null}

      {data.ready ? <CreateDemoForm /> : null}

      {data.rows.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {data.rows.map((pair) => <DemoPairCard key={pair.id} pair={pair} />)}
        </div>
      ) : data.ready && !loadError ? (
        <p className="u-micro text-ink-45">{t('admin.demo.empty')}</p>
      ) : null}
    </div>
  );
}
