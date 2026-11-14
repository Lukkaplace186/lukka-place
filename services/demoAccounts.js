/**
 * Demo accounts (2026-11-14, owner request): a demo customer and a demo agent,
 * made from /admin/demo, that the team uses to go through the product exactly
 * as a customer or an agent would, without reaching a real person or putting
 * anything on the storefront.
 *
 * THE ONE FACT EVERYTHING HANGS ON
 * Every demo account carries a reserved number: 243 0000 + 5 digits. No DRC
 * mobile number starts 2430 (they are 243 8x… / 243 9x…), so these numbers can
 * never belong to anyone, and the engine can tell demo traffic apart from the
 * number alone, with no database round trip. web/lib/demoPhone.js is the twin
 * of the pure half below (verify-pipeline compares them).
 *
 * WHAT HAPPENS TO A MESSAGE (services/chakra.js calls interceptSend first)
 *   - to a demo number: never sent to Meta. Recorded in whatsapp_message_log
 *     under that number (the admin page shows it), and copied to the pair's
 *     `deliver_to_phone` when the admin gave one.
 *   - to a real number while a demo action is running (the async context set
 *     by routes/admin.js for a demo request, or by the per-row wrappers in
 *     leadDispatch / viewing sweeps): never sent. Recorded under the demo
 *     number with the real recipient named, so the admin sees what the desk
 *     or an agency WOULD have received.
 *   - anything else: untouched.
 *
 * ROUTING (callers): a demo customer's visit request, enquiry or open request
 * goes to the paired demo agent only — never a listing's real agent, never a
 * wave of agencies, never the ops desk. A demo agent is never ranked for a
 * real customer's request (agentRanking excludes the prefix). Listings: the
 * Postgres trigger `properties_demo_guard` keeps a demo agent's listings
 * pending whoever approves them (migrations/20261114_demo_accounts.sql).
 */

const { AsyncLocalStorage } = require('node:async_hooks');

const DEMO_PHONE_PREFIX = '2430000';
const DEMO_PHONE_PATTERN = /^2430000\d{5}$/;

function digitsOf(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/** Is this a reserved demo number? Accepts '+243 0000 10001' style input. */
function isDemoPhone(value) {
  return DEMO_PHONE_PATTERN.test(digitsOf(value));
}

/** The demo numbers of a pair: agent 2430000 1NNNN, customer 2430000 2NNNN. */
function demoPhonesFor(pairId) {
  const n = Number(pairId);
  if (!Number.isSafeInteger(n) || n < 1 || n > 9999) throw new Error('demo pair id must be 1-9999');
  const suffix = String(n).padStart(4, '0');
  return { agentPhone: `${DEMO_PHONE_PREFIX}1${suffix}`, customerPhone: `${DEMO_PHONE_PREFIX}2${suffix}` };
}

/** SQL condition excluding demo agents, for an `agents` alias. */
function notDemoAgentSql(alias = 'a') {
  return `COALESCE(${alias}.phone, '') NOT LIKE '${DEMO_PHONE_PREFIX}%'`;
}

// ---------------------------------------------------------------------------
// Demo context
// ---------------------------------------------------------------------------

const storage = new AsyncLocalStorage();

/** Run `fn` as a demo action: sends to real numbers inside it are blocked. */
function runInDemo(context, fn) {
  return storage.run({ phone: digitsOf(context?.phone) || null }, fn);
}

/** Run `fn` as a demo action when `phone` is a demo number, else as is. */
function runForPhone(phone, fn) {
  return isDemoPhone(phone) ? runInDemo({ phone }, fn) : fn();
}

function currentDemo() {
  return storage.getStore() || null;
}

const BODY_PHONE_FIELDS = ['phone', 'wa_id', 'waId', 'customerPhone', 'customer_phone', 'customer_wa_id'];

/**
 * The demo context of an /admin request, or null. Web's engineFetch sends
 * `x-lukka-demo: <demo numbers>` while a demo session is the one acting; a
 * public form posts the demo customer's number in its body. Either only ever
 * restricts what the request may send.
 */
function contextFromRequest(req) {
  const header = String(req?.headers?.['x-lukka-demo'] || '');
  const fromHeader = header.split(',').map(digitsOf).find((p) => DEMO_PHONE_PATTERN.test(p));
  if (fromHeader) return { phone: fromHeader };
  const body = req?.body && typeof req.body === 'object' ? req.body : null;
  if (body) {
    for (const field of BODY_PHONE_FIELDS) {
      if (isDemoPhone(body[field])) return { phone: digitsOf(body[field]) };
    }
  }
  return null;
}

/** Express middleware: runs the rest of the request inside its demo context. */
function demoContextMiddleware(req, res, next) {
  const context = contextFromRequest(req);
  if (!context) return next();
  return runInDemo(context, next);
}

// ---------------------------------------------------------------------------
// Pairs (Postgres demo_accounts)
// ---------------------------------------------------------------------------

let pgModule = null;
function pg() {
  // eslint-disable-next-line global-require
  if (!pgModule) pgModule = require('./postgres');
  return pgModule;
}

const PAIR_TTL_MS = 30 * 1000;
const pairCache = new Map();
let tableKnown = null; // true for the process once seen; a "no" is re-checked after a minute
let tableCheckedAt = 0;

async function tableExists(pool) {
  if (tableKnown === true) return true;
  if (tableKnown === false && Date.now() - tableCheckedAt < 60 * 1000) return false;
  const { rows } = await pool.query("SELECT to_regclass('public.demo_accounts') IS NOT NULL AS ok");
  tableKnown = Boolean(rows[0]?.ok);
  tableCheckedAt = Date.now();
  return tableKnown;
}

function shapePair(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    label: row.label,
    agentId: row.agent_id == null ? null : Number(row.agent_id),
    customerId: row.customer_id == null ? null : Number(row.customer_id),
    agentPhone: row.agent_phone,
    customerPhone: row.customer_phone,
    deliverTo: row.deliver_to_phone || null,
  };
}

/** The live pair a demo number belongs to, or null. Never throws. */
async function getPairByPhone(phone) {
  const digits = digitsOf(phone);
  if (!DEMO_PHONE_PATTERN.test(digits)) return null;
  const cached = pairCache.get(digits);
  if (cached && Date.now() - cached.at < PAIR_TTL_MS) return cached.pair;
  try {
    if (!pg().isConfigured()) return null;
    const pool = pg().getPool();
    if (!(await tableExists(pool))) return null;
    const { rows } = await pool.query(
      `SELECT id, label, agent_id, customer_id, agent_phone, customer_phone, deliver_to_phone
         FROM demo_accounts
        WHERE (agent_phone = $1 OR customer_phone = $1) AND deleted_at IS NULL
        LIMIT 1`,
      [digits],
    );
    const pair = shapePair(rows[0]);
    pairCache.set(digits, { pair, at: Date.now() });
    return pair;
  } catch (err) {
    console.error(`[demo] pair lookup for ${digits} failed: ${err.message}`);
    return null;
  }
}

/** The pair a demo agent id belongs to, or null. Never throws. */
async function getPairByAgentId(agentId) {
  const id = Number(agentId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  try {
    if (!pg().isConfigured()) return null;
    const pool = pg().getPool();
    if (!(await tableExists(pool))) return null;
    const { rows } = await pool.query(
      `SELECT id, label, agent_id, customer_id, agent_phone, customer_phone, deliver_to_phone
         FROM demo_accounts WHERE agent_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    return shapePair(rows[0]);
  } catch (err) {
    console.error(`[demo] pair lookup for agent #${id} failed: ${err.message}`);
    return null;
  }
}

/**
 * The paired demo agent's contact, in the shape propertyRepository's
 * getAgentContactById returns, for a demo customer's number. Null when the
 * number is not a demo customer's or the pair has no agent.
 */
async function pairedAgentContact(customerPhone) {
  const pair = await getPairByPhone(customerPhone);
  if (!pair || !pair.agentId || digitsOf(customerPhone) !== pair.customerPhone) return null;
  try {
    // eslint-disable-next-line global-require
    const contact = await require('./propertyRepository').getAgentContactById(pair.agentId);
    return contact || null;
  } catch (err) {
    console.error(`[demo] paired agent #${pair.agentId} lookup failed: ${err.message}`);
    return null;
  }
}

/** verify-pipeline only. */
function _resetCache({ table } = {}) {
  pairCache.clear();
  tableKnown = table === undefined ? null : table;
  tableCheckedAt = table === undefined ? 0 : Date.now();
}
function _seedPair(pair) {
  for (const phone of [pair.agentPhone, pair.customerPhone]) {
    if (phone) pairCache.set(phone, { pair, at: Date.now() });
  }
}

// ---------------------------------------------------------------------------
// Outbound interception (services/chakra.js)
// ---------------------------------------------------------------------------

let messageLogModule = null;
function messageLog() {
  // eslint-disable-next-line global-require
  if (!messageLogModule) messageLogModule = require('./messageLog');
  return messageLogModule;
}

/** What chakra hands back for a message that never left: same shape, no id. */
function demoResult(reason) {
  return { demo: true, reason, messages: [], _data: { whatsappMessageId: null } };
}

function record(waId, message, note) {
  const prefix = note ? `${note}\n` : '';
  try {
    if (message.kind === 'template') {
      messageLog().recordOutboundTemplate(waId, message.templateName, {
        bodyParams: note ? [note, ...(message.bodyParams || [])] : message.bodyParams,
        buttons: message.buttons,
        urlButton: message.urlButton,
      }, demoResult('recorded'));
    } else if (message.kind === 'interactive') {
      messageLog().recordOutboundInteractive(waId, `${prefix}${message.text}`, message.buttons, demoResult('recorded'));
    } else {
      messageLog().recordOutboundText(waId, `${prefix}${message.text}`, demoResult('recorded'));
    }
  } catch (err) {
    console.error(`[demo] could not record a message for ${waId}: ${err.message}`);
  }
}

function sideLabel(pair, phone) {
  if (!pair) return 'compte démo';
  return phone === pair.agentPhone ? 'agent démo' : 'client démo';
}

/** Copy a message meant for a demo account to the admin's own phone. Never throws. */
async function forward(pair, to, message) {
  if (!pair?.deliverTo) return;
  // eslint-disable-next-line global-require
  const chakra = require('./chakra');
  const header = `🧪 Démo Lukka Place — message pour ${sideLabel(pair, to)} (${pair.label})`;
  try {
    if (message.kind === 'template') {
      await chakra.sendTemplate(pair.deliverTo, message.templateName, {
        ...message.options,
        _demoForward: true,
      });
    } else {
      const labels = message.kind === 'interactive'
        ? `\n${(message.buttons || []).map((b) => `[${b?.title || b?.id}]`).join(' ')}`
        : '';
      await chakra.sendWhatsAppMessage(pair.deliverTo, `${header}\n\n${message.text}${labels}`, {
        previewUrl: true,
        _demoForward: true,
      });
    }
    console.log(`[demo] ${message.kind} for ${to} copied to the pair's phone (…${String(pair.deliverTo).slice(-4)})`);
  } catch (err) {
    console.warn(`[demo] copy of a ${message.kind} for ${to} to the pair's phone failed: ${err.message}`);
  }
}

/**
 * Called by every chakra send before it reaches Meta.
 *
 * @param {string} to  Digits.
 * @param {{kind: 'text'|'template'|'interactive', text?: string, templateName?: string,
 *          bodyParams?: string[], buttons?: Object[], urlButton?: any, options?: Object}} message
 * @returns {Promise<Object|null>} A stand-in result when the message must not
 *   be sent; null when the send goes ahead as usual.
 */
async function interceptSend(to, message) {
  const digits = digitsOf(to);
  if (DEMO_PHONE_PATTERN.test(digits)) {
    record(digits, message, null);
    const pair = await getPairByPhone(digits);
    console.log(`[demo] ${message.kind} to demo number ${digits} recorded, not sent`);
    // Fire-and-forget: the caller's flow does not wait on the copy.
    if (pair?.deliverTo) forward(pair, digits, message).catch(() => {});
    return demoResult('demo-recipient');
  }
  const context = currentDemo();
  if (context) {
    const note = `[Démo — non envoyé à +${digits}]`;
    if (context.phone) record(context.phone, message, note);
    console.log(`[demo] ${message.kind} to real number …${digits.slice(-4)} blocked during a demo action`);
    return demoResult('blocked-real-recipient');
  }
  return null;
}

module.exports = {
  DEMO_PHONE_PREFIX,
  DEMO_PHONE_PATTERN,
  isDemoPhone,
  demoPhonesFor,
  notDemoAgentSql,
  runInDemo,
  runForPhone,
  currentDemo,
  contextFromRequest,
  demoContextMiddleware,
  getPairByPhone,
  getPairByAgentId,
  pairedAgentContact,
  interceptSend,
  _resetCache,
  _seedPair,
};
