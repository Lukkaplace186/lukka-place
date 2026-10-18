'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { CONTACT_PATH, LISTING_QUOTA_EVENT, UPGRADE_PATH } from '@/lib/listingQuotaRules';

/**
 * Why an agent cannot publish another listing, and the way forward. Mounted
 * once in the agent dashboard layout; opened by announceListingQuota() from
 * any action the server refused for the plan's listing limit (create,
 * duplicate, put back online), or before the form opens when the page already
 * knows the limit is reached.
 *
 * While the Abonnements tab is hidden (/admin/settings) the way forward is
 * the team, not a page that would only redirect.
 */
export default function ListingLimitDialog({ subscriptionsEnabled = true }) {
  const t = useT();
  const [quota, setQuota] = useState(null);

  useEffect(() => {
    function onQuota(event) {
      if (event.detail) setQuota(event.detail);
    }
    window.addEventListener(LISTING_QUOTA_EVENT, onQuota);
    return () => window.removeEventListener(LISTING_QUOTA_EVENT, onQuota);
  }, []);

  const plan = quota?.plan || t('agent.quota.currentPlan');

  return (
    <Dialog open={Boolean(quota)} onOpenChange={(open) => { if (!open) setQuota(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('agent.quota.title')}</DialogTitle>
          <DialogDescription>
            {quota ? t('agent.quota.reached', { limit: quota.limit, plan }) : ''}
          </DialogDescription>
        </DialogHeader>
        {quota ? (
          <p className="text-sm text-ink-70">
            {t('agent.quota.usage', { used: quota.used, limit: quota.limit })} {t('agent.quota.freeSlot')}
          </p>
        ) : null}
        <DialogFooter>
          <button
            type="button"
            onClick={() => setQuota(null)}
            className="u-btn-secondary u-press inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold text-ink"
          >
            {t('common.actions.close')}
          </button>
          <Link
            href={subscriptionsEnabled ? quota?.upgradeHref || UPGRADE_PATH : CONTACT_PATH}
            onClick={() => setQuota(null)}
            className="u-btn-primary u-press inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-blue px-4 text-sm font-bold text-white hover:bg-blue-deep"
          >
            <Sparkles strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {subscriptionsEnabled ? t('agent.quota.upgrade') : t('agent.quota.contactTeam')}
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
