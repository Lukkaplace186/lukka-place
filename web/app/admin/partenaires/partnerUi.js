import { frNumber } from '@/lib/format';
import { INPUT } from '../sales/styles';

// Plain module (no 'use client'): the list and the partner page both import it.

const FLASH = {
  created: { tone: 'success', key: 'admin.partners.flash.created' },
  saved: { tone: 'success', key: 'admin.partners.flash.saved' },
  activated: { tone: 'success', key: 'admin.partners.flash.activated' },
  deactivated: { tone: 'success', key: 'admin.partners.flash.deactivated' },
  code_taken: { tone: 'danger', key: 'admin.partners.flash.codeTaken' },
  code_needed: { tone: 'danger', key: 'admin.partners.flash.codeNeeded' },
  unavailable: { tone: 'danger', key: 'admin.partners.unavailable' },
  invalid_name: { tone: 'danger', key: 'admin.partners.flash.invalidName' },
  invalid_kind: { tone: 'danger', key: 'admin.partners.flash.invalidKind' },
  invalid_code_format: { tone: 'danger', key: 'admin.partners.flash.invalidCode' },
  invalid_fee: { tone: 'danger', key: 'admin.partners.flash.invalidFee' },
  failed: { tone: 'danger', key: 'admin.partners.flash.failed' },
  stats_saved: { tone: 'success', key: 'admin.partners.flash.statsSaved' },
  invalid_week: { tone: 'danger', key: 'admin.partners.flash.invalidWeek' },
  invalid_figures: { tone: 'danger', key: 'admin.partners.flash.invalidFigures' },
};

export function flashFor(key) {
  return FLASH[key] || null;
}

/** "12,50 $" / "25 000 FC", or null. Never summed across currencies. */
export function formatCost(cost) {
  if (!cost) return null;
  return cost.currency === 'CDF' ? `${frNumber(Math.round(cost.amount))} FC` : `${frNumber(cost.amount)} $`;
}

/** Fee amount, currency and basis — shared by the create and edit forms. */
export function FeeFields({ t, fee = null }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)] gap-2 sm:col-span-2">
      <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
        {t('admin.partners.form.fee')}
        <input name="fee_amount" inputMode="decimal" defaultValue={fee?.amount ?? ''} className={INPUT} placeholder="150" />
      </label>
      <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
        {t('admin.partners.form.currency')}
        <select name="fee_currency" defaultValue={fee?.currency || 'USD'} className={INPUT}>
          <option value="USD">USD</option>
          <option value="CDF">CDF</option>
        </select>
      </label>
      <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
        {t('admin.partners.form.basis')}
        <select name="fee_basis" defaultValue={fee?.basis || 'flat'} className={INPUT}>
          <option value="flat">{t('admin.partners.form.basisFlat')}</option>
          <option value="per_signup">{t('admin.partners.form.basisPerSignup')}</option>
        </select>
      </label>
    </div>
  );
}
