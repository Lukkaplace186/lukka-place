'use client';

import { useState } from 'react';
import { ListPlus, ListChecks } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { useVisitCart } from '@/lib/useVisitCart';
import { OPEN_VISIT_CART_EVENT, addToCart, removeFromCart, writeCart } from '@/lib/visitCart';
import { VISIT_CART_MAX } from '@/lib/visitSlots';

/**
 * "Ajouter à mes visites" — puts this listing in the visitor's "Mes visites"
 * selection (lib/visitCart.js, up to four), to request them all at once from
 * the sheet (components/VisitCartSheet.js). A second tap removes it.
 *
 * Feedback is inline, not a toast: the storefront has no ToastProvider (only
 * the portals do), and useToast throws outside one.
 */
// `variant="link"`: the listing page's compact phone card (2026-11-18), a
// quiet text link under the WhatsApp button instead of a full-width button.
export default function AddToVisitCartButton({ listing, variant = 'button' }) {
  const t = useT();
  const cart = useVisitCart();
  const [full, setFull] = useState(false);
  const inCart = cart.some((item) => item.id === Number(listing.id));

  function toggle() {
    setFull(false);
    if (inCart) {
      writeCart(removeFromCart(cart, listing.id));
      return;
    }
    const result = addToCart(cart, listing);
    if (!result.added) {
      if (result.reason === 'full') setFull(true);
      return;
    }
    writeCart(result.cart);
  }

  const Icon = inCart ? ListChecks : ListPlus;
  const label = inCart ? t('enquiry.cart.inCart', { count: cart.length, max: VISIT_CART_MAX }) : t('enquiry.cart.add');

  if (variant === 'link') {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-center gap-x-4">
          <button
            type="button"
            onClick={toggle}
            aria-pressed={inCart}
            className="u-press inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-blue-deep underline-offset-4 hover:underline"
          >
            <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {label}
          </button>
          {inCart ? (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event(OPEN_VISIT_CART_EVENT))}
              className="u-press inline-flex min-h-11 items-center text-sm font-bold text-ink underline underline-offset-4"
            >
              {t('enquiry.cart.open')}
            </button>
          ) : null}
        </div>
        {full ? (
          <p className="text-center text-xs text-danger" role="alert">{t('enquiry.cart.full', { max: VISIT_CART_MAX })}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-pressed={inCart}
          className="u-press inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-line px-4 text-sm font-semibold text-ink hover:bg-canvas-alt"
        >
          <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
          {label}
        </button>
        {inCart ? (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(OPEN_VISIT_CART_EVENT))}
            className="u-press inline-flex min-h-11 items-center rounded-lg bg-ink px-4 text-sm font-bold text-white"
          >
            {t('enquiry.cart.open')}
          </button>
        ) : null}
      </div>
      {full ? (
        <p className="text-xs text-danger" role="alert">{t('enquiry.cart.full', { max: VISIT_CART_MAX })}</p>
      ) : null}
    </div>
  );
}
