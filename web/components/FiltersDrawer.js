'use client';

import Link from 'next/link';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import AdvancedFilterFields from './AdvancedFilterFields';

/**
 * "Plus de filtres" — the fields that do not earn their own top-bar pill.
 * The actual field markup lives in AdvancedFilterFields.js now, shared with
 * FilterModal.js's mobile "Filtres" sheet — this component owns the Sheet
 * chrome (header, scroll area, bottom action bar) and the reset behaviour
 * specific to this desktop entry point.
 *
 * Values and setters come from FilterBar, which owns all filter state. This
 * sheet renders through a Radix portal to document.body, so it is outside
 * the form element — it holds no form fields of its own, only controls that
 * write back into that state.
 */
export default function FiltersDrawer({
  open,
  onClose,
  onApply,
  quartiers,
  commune,
  propertyType,
  values = {},
  setters = {},
  resultCountLabel,
  resultPending,
}) {
  const { setQuartier, setParcelleSubtype, setBedsMin, setBathMin, setDepositMax, setAmenities } = setters;

  function reset() {
    setQuartier?.('');
    setParcelleSubtype?.('');
    setBedsMin?.('');
    setBathMin?.('');
    setDepositMax?.('');
    setAmenities?.([]);
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" className="max-h-[85vh] rounded-t-xl border-line bg-surface">
        <SheetHeader className="border-b border-line">
          <SheetTitle className="font-display text-xl font-normal tracking-[-0.01em]">Plus de filtres</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-6 overflow-y-auto px-4 py-5">
          <AdvancedFilterFields
            quartiers={quartiers}
            commune={commune}
            propertyType={propertyType}
            values={values}
            setters={setters}
          />
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-3">
          <Link
            href="/listings"
            onClick={reset}
            className="u-press u-btn-secondary flex-1 rounded-full py-2.5 text-center text-sm font-semibold text-ink"
          >
            Réinitialiser
          </Link>
          <button
            type="button"
            onClick={() => {
              onClose();
              onApply?.();
            }}
            className={`u-press flex-1 rounded-full bg-blue py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary ${resultPending ? 'opacity-70' : ''}`}
          >
            {resultCountLabel || 'Voir les résultats'}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
