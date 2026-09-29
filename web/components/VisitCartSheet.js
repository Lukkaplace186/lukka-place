'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { CalendarClock, CheckCircle2, ListChecks, X } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useLocale, useT } from '@/lib/i18n/client';
import { useVisitCart } from '@/lib/useVisitCart';
import { OPEN_VISIT_CART_EVENT, removeFromCart, writeCart } from '@/lib/visitCart';
import { VISIT_CART_MAX, tightPairs } from '@/lib/visitSlots';
import { formatVisitSlot } from '@/lib/visitAgenda';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { submitVisitBatchAction } from '@/app/(site)/listings/visitBatchActions';
import SafeImage from './SafeImage';
import PhoneField from './PhoneField';
import VisitSlotPicker from './VisitSlotPicker';

/**
 * "Mes visites": the floating pill (only while the selection holds something)
 * and the sheet that sends every selected listing in one request — one slot
 * per listing, a warning when two are under an hour apart (it does not
 * refuse: two flats in one building can be seen back to back), then name and
 * WhatsApp number. submitVisitBatchAction re-checks everything; each agent is
 * alerted about their own listing only.
 */
export default function VisitCartSheet() {
  const t = useT();
  const locale = useLocale();
  const cart = useVisitCart();
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState({});
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_VISIT_CART_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_VISIT_CART_EVENT, onOpen);
  }, []);

  const chosen = cart.map((item) => slots[item.id]).filter(Boolean);
  const ready = cart.length > 0 && chosen.length === cart.length;
  const tight = tightPairs(chosen);

  function submit(formData) {
    setError(null);
    formData.set('items', JSON.stringify(cart.map((item) => ({ id: item.id, slot: slots[item.id] }))));
    startTransition(async () => {
      let result;
      try {
        result = await submitVisitBatchAction(formData);
      } catch {
        result = { ok: false, error: t('enquiry.cart.errors.failed') };
      }
      if (!result.ok) {
        setError(result.error);
        if (result.goneId) writeCart(removeFromCart(cart, result.goneId));
        return;
      }
      setSent(result.requests);
      setSlots({});
      writeCart([]);
    });
  }

  if (cart.length === 0 && !open) return null;

  return (
    <>
      {cart.length > 0 ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="u-press fixed right-3 top-[4.5rem] z-40 inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-4 text-sm font-bold text-white shadow-lg"
        >
          <ListChecks strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('enquiry.cart.pill', { count: cart.length, max: VISIT_CART_MAX })}
        </button>
      ) : null}

      <Sheet open={open} onOpenChange={(value) => { setOpen(value); if (!value) setSent(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t('enquiry.cart.title')}</SheetTitle>
            <SheetDescription>{t('enquiry.cart.intro', { max: VISIT_CART_MAX })}</SheetDescription>
          </SheetHeader>

          {sent ? (
            <div className="flex flex-col gap-3 px-4 pb-6">
              <p className="flex items-start gap-2 rounded-lg bg-success-tint px-3 py-2.5 text-sm font-semibold text-success" role="status">
                <CheckCircle2 strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 flex-none" />
                {t('enquiry.cart.sent', { count: sent.length })}
              </p>
              <ul className="flex flex-col gap-2">
                {sent.map((request) => (
                  <li key={request.id} className="rounded-lg border border-line px-3 py-2 text-sm">
                    <span className="font-semibold text-ink">{request.title}</span>
                    <span className="block text-ink-70">{request.phrase}</span>
                  </li>
                ))}
              </ul>
              <Link href="/compte/client/visites" className="u-btn-primary u-press inline-flex min-h-11 items-center justify-center rounded-lg bg-blue px-4 text-sm font-bold text-white">
                {t('enquiry.cart.seeAgenda')}
              </Link>
            </div>
          ) : cart.length === 0 ? (
            <p className="px-4 text-sm text-ink-70">{t('enquiry.cart.empty')}</p>
          ) : (
            <form action={submit} className="flex flex-col gap-4 px-4 pb-6">
              <ul className="flex flex-col gap-3">
                {cart.map((item) => {
                  const slot = slots[item.id];
                  const showPicker = !slot || editing === item.id;
                  return (
                    <li key={item.id} className="flex flex-col gap-2.5 rounded-xl border border-line p-3">
                      <div className="flex items-start gap-3">
                        <div className="relative h-12 w-16 flex-none overflow-hidden rounded-md bg-canvas-alt">
                          {item.image ? <SafeImage src={item.image} alt="" fill sizes="64px" className="object-cover" /> : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink">{item.title}</p>
                          <p className="truncate text-xs text-ink-45">{[item.place, item.priceLabel].filter(Boolean).join(' · ')}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => writeCart(removeFromCart(cart, item.id))}
                          aria-label={t('enquiry.cart.remove')}
                          className="u-hit relative rounded-full p-1 text-ink-45 hover:text-ink"
                        >
                          <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                        </button>
                      </div>
                      {showPicker ? (
                        <VisitSlotPicker
                          propertyId={item.id}
                          idPrefix={`cart-${item.id}`}
                          value={slot || null}
                          onChange={(iso) => {
                            setSlots((prev) => ({ ...prev, [item.id]: iso }));
                            setEditing(null);
                          }}
                        />
                      ) : (
                        <div className="flex items-center justify-between gap-2 rounded-lg bg-blue-tint px-3 py-2">
                          <span className="flex items-center gap-1.5 text-sm font-semibold text-blue-deep">
                            <CalendarClock strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                            {formatVisitSlot(slot, locale)}
                          </span>
                          <button type="button" onClick={() => setEditing(item.id)} className="text-xs font-semibold text-blue-deep underline">
                            {t('enquiry.cart.change')}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {tight.length ? <p className="rounded-lg bg-warning-tint px-3 py-2 text-sm text-warning">{t('enquiry.cart.tight')}</p> : null}

              <div>
                <label htmlFor="cart-name" className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">{t('enquiry.nameOptional')}</label>
                <input id="cart-name" name="name" autoComplete="name" className="h-11 w-full rounded-lg border border-line bg-surface px-3 text-base text-ink sm:text-sm" />
              </div>
              <PhoneField
                name="phone"
                id="cart-phone"
                locale={locale}
                labels={{ ...phoneFieldLabels(t), label: t('enquiry.whatsappNumber') }}
                labelClassName="mb-1.5 text-[0.8125rem] font-semibold normal-case tracking-normal text-ink-70"
                fieldClassName="h-11 rounded-lg bg-surface"
                required
              />

              {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}

              <button
                type="submit"
                disabled={!ready || pending}
                className="u-btn-primary u-press inline-flex min-h-11 items-center justify-center rounded-lg bg-blue px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                {pending ? t('enquiry.cart.sending') : ready ? t('enquiry.cart.submit', { count: cart.length }) : t('enquiry.cart.pickAll')}
              </button>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
