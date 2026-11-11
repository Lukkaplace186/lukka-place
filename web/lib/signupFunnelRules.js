/**
 * Customer sign-up funnel — the pure half (no DB, safe in the browser).
 *
 * Built 2026-11-11 (owner: "1,000 customer accounts", and the bottleneck is
 * visitors who never create one). Before this, /admin/croissance counted
 * accounts by channel, but nothing said WHICH prompt produced them, or how
 * many people saw a prompt and left: the signup-funnel log covered the agent
 * form and the no-account request form only.
 *
 * An ENTRY is the place a sign-up started (the ♥, a saved search, the nudge
 * card, a page link…). It rides to /compte/inscription as `?entree=<entry>`,
 * then as a hidden field into signupAction, so the account row's `created`
 * event names it. A sign-up that arrives with no entry is `direct`.
 *
 * Steps, in order:
 *   prompt_shown  a prompt was put in front of the visitor (modal opened, nudge displayed)
 *   prompt_open   they pressed its button towards the sign-up page
 *   form_view     the sign-up page loaded
 *   form_start    the first character typed in the account form (not focus:
 *                 the name field is autoFocused)
 *   submit        the form was sent
 *   refused       the server sent it back (with the reason)
 *   created       the account exists (server-side, with the customer id)
 * Plain page links (/messages, the login page…) have no prompt steps: their
 * funnel starts at form_view.
 */

/** The owner's target (2026-11-11). Read by the dashboard only. */
export const CUSTOMER_SIGNUP_GOAL = 1000;

/** The URL parameter that carries the entry to the sign-up page. */
export const SIGNUP_ENTRY_PARAM = 'entree';

export const SIGNUP_ENTRIES = [
  'favorite', // the ♥ on a card or a listing (AuthPromptModal)
  'save_search', // "Sauvegarder la recherche" (SaveSearchButton)
  'alert', // "Créer une alerte" (SaveSearchButton, QueryAlertButton)
  'nudge', // the "Créez un compte…" card (SignupNudge)
  'messages', // the guest screen of /messages
  'updates', // /mises-a-jour
  'login_page', // "Créer un compte" under the login form
  'partner_invite', // /i/<code>, an agent's or creator's invitation
  'price_guide', // the price guide (reserved for its sign-up hook)
  'direct', // anything else: a typed URL, an old link, a shared link
];

const ENTRY_SET = new Set(SIGNUP_ENTRIES);

/** Entries that are a prompt (shown, then opened); the others are plain links. */
export const PROMPT_ENTRIES = new Set(['favorite', 'save_search', 'alert', 'nudge']);

/** Steps a browser may report. `refused` and `created` are server-only. */
export const CLIENT_SIGNUP_STEPS = ['prompt_shown', 'prompt_open', 'form_view', 'form_start', 'submit'];
export const SIGNUP_FUNNEL_STEPS = [...CLIENT_SIGNUP_STEPS, 'refused', 'created'];

/** signupAction's refusal codes (SignupForm's ERROR_MESSAGE_KEYS). */
export const SIGNUP_REFUSALS = ['name', 'phone', 'password', 'exists', 'ref'];

const CLIENT_STEP_SET = new Set(CLIENT_SIGNUP_STEPS);
const STEP_SET = new Set(SIGNUP_FUNNEL_STEPS);
const REFUSAL_SET = new Set(SIGNUP_REFUSALS);

/** A known entry, or 'direct'. */
export function cleanSignupEntry(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ENTRY_SET.has(text) ? text : 'direct';
}

export function isClientSignupStep(step) {
  return CLIENT_STEP_SET.has(step);
}

export function isSignupStep(step) {
  return STEP_SET.has(step);
}

export function cleanSignupRefusal(value) {
  return REFUSAL_SET.has(value) ? value : null;
}

/** AuthPromptModal's `trigger` → entry. */
export function entryForPromptTrigger(trigger) {
  if (trigger === 'favorite') return 'favorite';
  if (trigger === 'alert') return 'alert';
  return 'save_search';
}

/** `href` with `?entree=<entry>` added (an existing query is kept). */
export function withSignupEntry(href, entry) {
  const clean = cleanSignupEntry(entry);
  const text = String(href || '/compte/inscription');
  const [base, hash = ''] = text.split('#');
  const joiner = base.includes('?') ? '&' : '?';
  return `${base}${joiner}${SIGNUP_ENTRY_PARAM}=${clean}${hash ? `#${hash}` : ''}`;
}

/**
 * Funnel rows (`{ entry, step, people, events }`, from SQL) → one row per
 * entry with every step, the conversion from the first measured step to an
 * account, and the refusals by reason. Entries with nothing are left out.
 *
 * `people` counts distinct visitors (rows with no visitor id count once
 * each); `created` and `refused` count accounts and refusals, not people.
 */
export function summariseSignupFunnel(rows = [], refusalRows = []) {
  const byEntry = new Map();
  const ensure = (entry) => {
    if (!byEntry.has(entry)) {
      byEntry.set(entry, {
        entry,
        ...Object.fromEntries(SIGNUP_FUNNEL_STEPS.map((step) => [step, 0])),
        refusals: {},
      });
    }
    return byEntry.get(entry);
  };
  for (const row of rows) {
    if (!isSignupStep(row.step)) continue;
    const item = ensure(cleanSignupEntry(row.entry));
    const n = row.step === 'created' || row.step === 'refused' ? Number(row.events) : Number(row.people);
    item[row.step] += Number.isFinite(n) ? n : 0;
  }
  for (const row of refusalRows) {
    const reason = cleanSignupRefusal(row.refusal);
    if (!reason) continue;
    const item = ensure(cleanSignupEntry(row.entry));
    item.refusals[reason] = (item.refusals[reason] || 0) + Number(row.events || 0);
  }

  const list = [...byEntry.values()].map((item) => {
    // The first step this entry measures: a prompt, else the page.
    const top = item.prompt_shown || item.prompt_open || item.form_view;
    return { ...item, top, conversion: top > 0 ? item.created / top : null };
  });
  list.sort((a, b) => b.created - a.created || b.top - a.top || SIGNUP_ENTRIES.indexOf(a.entry) - SIGNUP_ENTRIES.indexOf(b.entry));

  const totals = Object.fromEntries(SIGNUP_FUNNEL_STEPS.map((step) => [step, list.reduce((sum, item) => sum + item[step], 0)]));
  const refusals = {};
  for (const item of list) {
    for (const [reason, n] of Object.entries(item.refusals)) refusals[reason] = (refusals[reason] || 0) + n;
  }
  return { entries: list, totals, refusals };
}

/**
 * Where the 1,000 stands. `recentDays` accounts over the last `recentSpan`
 * days give the pace; the date at that pace is an estimate and is labelled
 * so on the page. No pace (no account in the window) → no estimate.
 */
export function signupGoalProgress({ total, today, week, recent, recentSpan = 14, goal = CUSTOMER_SIGNUP_GOAL }) {
  const count = Math.max(0, Number(total) || 0);
  const remaining = Math.max(0, goal - count);
  const perDay = recentSpan > 0 ? (Number(recent) || 0) / recentSpan : 0;
  return {
    goal,
    total: count,
    today: Number(today) || 0,
    week: Number(week) || 0,
    remaining,
    percent: Math.min(100, Math.round((count / goal) * 1000) / 10),
    perDay: Math.round(perDay * 10) / 10,
    daysToGoal: remaining === 0 ? 0 : perDay > 0 ? Math.ceil(remaining / perDay) : null,
  };
}
