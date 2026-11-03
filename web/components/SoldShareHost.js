'use client';

import { useEffect, useState } from 'react';
import { PartyPopper } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import Confetti from './Confetti';
import ListingQuickShare from './ListingQuickShare';

const SOLD_SHARE_EVENT = 'lukka:listing-sold';

/** Called by MarkListingSoldDialog once a listing really was marked let / sold. */
export function announceSoldShare(listing) {
  if (typeof window === 'undefined' || !listing?.id) return;
  window.dispatchEvent(new CustomEvent(SOLD_SHARE_EVENT, { detail: listing }));
}

/**
 * "Bravo !" then the "Loué via Lukka Place" card (2026-11-03) — mounted once
 * in the agent layout, like ListingLimitDialog, because the row that marked
 * the listing can leave Mes biens' list the moment it is closed.
 *
 * Step 1, a confetti moment with one button. Step 2, the share dialog drawing
 * the listing's own card with "Loué / Vendu via Lukka Place" where the price
 * was (lib/marketing/soldShareKit.js; ListingQuickShare audience "sold").
 */
export default function SoldShareHost() {
  const t = useT();
  const [listing, setListing] = useState(null);
  const [step, setStep] = useState(null); // 'bravo' | 'share' | null

  useEffect(() => {
    function onSold(event) {
      setListing(event.detail);
      setStep('bravo');
    }
    window.addEventListener(SOLD_SHARE_EVENT, onSold);
    return () => window.removeEventListener(SOLD_SHARE_EVENT, onSold);
  }, []);

  if (!listing) return null;
  const isRent = listing.purpose !== 'sale';

  return (
    <>
      <Dialog open={step === 'bravo'} onOpenChange={(next) => (next ? null : setStep(null))}>
        <DialogContent className="overflow-hidden">
          <Confetti className="left-1/2 top-10" />
          <div className="flex flex-col items-center gap-3 pt-2 text-center">
            <span className="u-pop grid h-14 w-14 place-items-center rounded-full bg-green-tint text-green-ink">
              <PartyPopper strokeWidth={ICON_STROKE_WIDTH} className="h-7 w-7" aria-hidden="true" />
            </span>
            <DialogHeader className="items-center text-center">
              <DialogTitle>{isRent ? t('agent.soldShare.bravoLet') : t('agent.soldShare.bravoSold')}</DialogTitle>
              <DialogDescription>{t('agent.soldShare.bravoBody')}</DialogDescription>
            </DialogHeader>
            <button
              type="button"
              onClick={() => setStep('share')}
              className="u-btn-primary u-press inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-green-ink px-5 text-[0.9375rem] font-bold text-white"
            >
              {isRent ? t('agent.soldShare.shareLet') : t('agent.soldShare.shareSold')}
            </button>
            <button
              type="button"
              onClick={() => setStep(null)}
              className="u-press inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-ink-45 hover:text-ink"
            >
              {t('agent.soldShare.later')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {step === 'share' ? (
        <ListingQuickShare listing={listing} audience="sold" open onOpenChange={(next) => (next ? null : setStep(null))} />
      ) : null}
    </>
  );
}
