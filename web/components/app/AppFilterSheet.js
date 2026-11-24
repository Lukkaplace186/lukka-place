'use client';

import { m, useDragControls } from 'motion/react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useT } from '@/lib/i18n/client';
import { useBackToClose } from '@/lib/useBackToClose';

/**
 * The app design's "Filters" bottom sheet, around FilterModal's own fields
 * (passed as children, so the app and the website can never offer different
 * filters) and FilterBar's live count. As tall as its content, 88% of the
 * screen at most; the grab handle drags it down to close (only the handle
 * starts a drag, so the fields still scroll); "Réinitialiser" beside the
 * title; one full-width "Voir N biens".
 *
 * The visible panel is a motion element inside a transparent Radix sheet:
 * Radix keeps the focus trap, Escape and the overlay; motion moves the panel.
 * Loaded through next/dynamic from FilterModal, in app mode only.
 */
export default function AppFilterSheet({ open, onClose, onApply: applyFilters, onReset, applyLabel, resultPending, children }) {
  const t = useT();
  const dragControls = useDragControls();
  // Android's back button / the iPhone edge swipe close the sheet, not the page.
  const releaseBack = useBackToClose(open, onClose);
  const onApply = () => {
    releaseBack();
    applyFilters?.();
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" showCloseButton={false} className="gap-0 border-0 bg-transparent p-0 shadow-none data-[side=bottom]:h-auto lg:hidden">
        <m.div
          drag="y"
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.7 }}
          onDragEnd={(event, info) => {
            if (info.offset.y > 110 || info.velocity.y > 600) onClose();
          }}
          className="flex max-h-[88dvh] flex-col rounded-t-3xl bg-surface"
        >
          <div onPointerDown={(event) => dragControls.start(event)} className="shrink-0 cursor-grab touch-none px-5 pb-3 pt-2.5">
            <span aria-hidden="true" className="mx-auto mb-3 block h-1.5 w-10 rounded-full bg-line" />
            <div className="flex items-center justify-between">
              <SheetTitle className="text-[1.375rem] font-bold text-ink">{t('listings.filters.title')}</SheetTitle>
              <button type="button" onClick={onReset} className="u-press min-h-11 px-1 text-[0.9375rem] font-semibold text-blue">
                {t('appShell.filters.reset')}
              </button>
            </div>
          </div>
          {children}
          <div className="shrink-0 border-t border-line px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => {
                onClose();
                onApply?.();
              }}
              aria-busy={resultPending || undefined}
              className={`u-press h-12 w-full rounded-xl bg-blue text-[0.9375rem] font-semibold text-white`}
            >
              {applyLabel}
            </button>
          </div>
        </m.div>
      </SheetContent>
    </Sheet>
  );
}
