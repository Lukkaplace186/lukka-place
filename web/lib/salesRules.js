/**
 * Pure rules for the sales console — no database, no `server-only`, so client
 * forms can use the same parsing the Server Actions enforce.
 */

export const SALES_PERIODS = ['month', '30d', '90d', 'year', 'all'];
export const COMMISSION_STATUSES = ['pending', 'approved', 'paid', 'void'];
export const COMMISSION_SOURCES = ['subscription', 'onboarding', 'target', 'adjustment'];
export const REP_STATUSES = ['active', 'inactive'];

const KINSHASA_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no daylight saving
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The [from, to) window a period filter means, in Kinshasa's calendar.
 * `from` is null for "all". Both ISO strings.
 */
export function periodRange(period, now = new Date()) {
  const to = new Date(now.getTime()).toISOString();
  const local = new Date(now.getTime() + KINSHASA_OFFSET_MS);
  switch (SALES_PERIODS.includes(period) ? period : 'month') {
    case 'month':
      return { from: new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - KINSHASA_OFFSET_MS).toISOString(), to };
    case 'year':
      return { from: new Date(Date.UTC(local.getUTCFullYear(), 0, 1) - KINSHASA_OFFSET_MS).toISOString(), to };
    case '30d':
      return { from: new Date(now.getTime() - 30 * DAY_MS).toISOString(), to };
    case '90d':
      return { from: new Date(now.getTime() - 90 * DAY_MS).toISOString(), to };
    default:
      return { from: null, to };
  }
}

/**
 * A money amount typed by a person: "1 200,50", "1200.50", "-25". Two decimals.
 * @returns {number|null}
 */
export function parseAmount(value, { allowNegative = false, allowZero = true } = {}) {
  const text = String(value ?? '').trim().replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^-?\d{1,9}(\.\d{1,2})?$/.test(text)) return null;
  const amount = Math.round(Number(text) * 100) / 100;
  if (!Number.isFinite(amount)) return null;
  if (amount < 0 && !allowNegative) return null;
  if (amount === 0 && !allowZero) return null;
  return amount;
}

export function normaliseCurrency(value) {
  const text = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(text) ? text : null;
}

/** @returns {{errorKey: string} | {values: object}} */
export function validatePlanInput({ name, currency, onboardingBonus, subscriptionRate, monthlyTarget, targetBonus, active }) {
  const cleanName = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!cleanName || cleanName.length > 80) return { errorKey: 'admin.sales.plans.nameInvalid' };
  const code = normaliseCurrency(currency);
  if (!code) return { errorKey: 'admin.sales.plans.currencyInvalid' };
  const bonus = parseAmount(onboardingBonus === '' || onboardingBonus == null ? '0' : onboardingBonus);
  const rate = parseAmount(subscriptionRate === '' || subscriptionRate == null ? '0' : subscriptionRate);
  const target = String(monthlyTarget ?? '').trim() === '' ? 0 : Number(monthlyTarget);
  const tBonus = parseAmount(targetBonus === '' || targetBonus == null ? '0' : targetBonus);
  if (bonus == null || tBonus == null) return { errorKey: 'admin.sales.plans.amountInvalid' };
  if (rate == null || rate > 100) return { errorKey: 'admin.sales.plans.rateInvalid' };
  if (!Number.isInteger(target) || target < 0 || target > 10000) return { errorKey: 'admin.sales.plans.targetInvalid' };
  if ((target > 0) !== (tBonus > 0)) return { errorKey: 'admin.sales.plans.targetPair' };
  return {
    values: {
      name: cleanName, currency: code, onboardingBonus: bonus, subscriptionRate: rate,
      monthlyTarget: target, targetBonus: tBonus, active: active === true || active === 'on' || active === 'true',
    },
  };
}

/** @returns {{errorKey: string} | {values: object}} */
export function validateRepInput({ fullName, phone, email, planId, status, adminUserId }) {
  const name = String(fullName ?? '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 120) return { errorKey: 'admin.sales.reps.nameInvalid' };
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits && !/^\d{7,15}$/.test(digits)) return { errorKey: 'admin.sales.reps.phoneInvalid' };
  const mail = String(email ?? '').trim();
  if (mail && (mail.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail))) return { errorKey: 'admin.sales.reps.emailInvalid' };
  const plan = String(planId ?? '').trim();
  if (plan && !/^\d+$/.test(plan)) return { errorKey: 'admin.sales.reps.planInvalid' };
  const account = String(adminUserId ?? '').trim();
  if (account && !/^\d+$/.test(account)) return { errorKey: 'admin.sales.reps.accountInvalid' };
  const resolvedStatus = REP_STATUSES.includes(status) ? status : 'active';
  return {
    values: {
      fullName: name, phone: digits || null, email: mail || null, planId: plan ? Number(plan) : null,
      status: resolvedStatus, adminUserId: account ? Number(account) : null,
    },
  };
}

/** Sum a numeric field of rows, per currency. @returns {{currency: string, amount: number}[]} */
export function sumByCurrency(rows, field) {
  const totals = new Map();
  for (const row of rows || []) {
    const value = Number(row?.[field]);
    if (!Number.isFinite(value) || !row?.currency) continue;
    totals.set(row.currency, Math.round(((totals.get(row.currency) || 0) + value) * 100) / 100);
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => a.currency.localeCompare(b.currency));
}

/** "1 200,00 USD · 50 000,00 CDF", or "—" when there is nothing. Zero totals are dropped. */
export function formatMoneyList(list, { field = 'amount', keepZero = false } = {}) {
  const parts = (list || [])
    .filter((item) => keepZero || Number(item?.[field]) !== 0)
    .map((item) => `${Number(item[field] || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${item.currency}`);
  return parts.length ? parts.join(' · ') : '—';
}
