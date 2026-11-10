/**
 * services/pushNotify.js
 *
 * App alerts first, WhatsApp as the fallback (owner decision 2026-11-10).
 *
 * WhatsApp only reaches someone who wrote to us in the last 24 h unless a Meta
 * template is approved. The Lukka Place app (Google Play + App Store, a
 * Capacitor shell around the agent space) receives push notifications through
 * Firebase Cloud Messaging, which also carries iPhone pushes through Apple.
 *
 * `pushFirst` is what an alert calls instead of its WhatsApp send:
 *
 *   1. The alert is recorded in `notifications` (the agent's in-app inbox,
 *      and the record of what reached whom).
 *   2. It is pushed to every phone where the agent is logged in to the app.
 *   3. WhatsApp goes NOW, exactly as before, when the agent has no app, no
 *      push was accepted, the tables do not exist yet, FCM is not configured
 *      or PUSH_NOTIFY=off.
 *   4. An URGENT alert that was pushed but is still unread after
 *      PUSH_FALLBACK_MIN minutes (default 5) gets its WhatsApp copy from the
 *      `push-fallback` job, once (`whatsapp_fallback_at` is claimed first).
 *      The copy is sent by the alert's own module (FALLBACK_SENDERS), so it
 *      keeps its template-or-text logic, and that module may decide it is no
 *      longer needed (a viewing request the agent already answered).
 *
 * Never throws for the push half: any failure there means "send WhatsApp
 * now". The WhatsApp half throws exactly as the send it wraps did, so callers
 * keep their own error handling.
 *
 * No firebase-admin: the FCM HTTP v1 API needs one OAuth token, signed here
 * with the service account's key (RS256) — no dependency to install on the VPS.
 *
 * Env, read at call time:
 *   PUSH_NOTIFY=off        WhatsApp only, nothing recorded (kill switch).
 *   FCM_SERVICE_ACCOUNT    Path to the Firebase service-account JSON file
 *                          (or the JSON itself). Unset → no push is attempted;
 *                          alerts are still recorded for the inbox.
 *   PUSH_FALLBACK_MIN      Minutes before an unread urgent alert also goes on
 *                          WhatsApp. Default 5, clamped to 1–120.
 */

const crypto = require('crypto');
const fs = require('fs');
const postgres = require('./postgres');

const TABLES = ['push_devices', 'notifications'];
const MAX_DEVICES = 5;
const FALLBACK_BATCH = 20;
/** A fallback this late would only confuse: the moment has passed. */
const FALLBACK_MAX_AGE_HOURS = 6;
const TITLE_MAX = 120;
const BODY_MAX = 500;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function pushEnabled() {
  return String(process.env.PUSH_NOTIFY || '').trim().toLowerCase() !== 'off';
}

/**
 * Minutes an urgent push may stay unread before its WhatsApp copy. Agents: 5
 * (PUSH_FALLBACK_MIN; the 15-minute visit SLA). Customers: 10
 * (PUSH_CUSTOMER_FALLBACK_MIN; nobody is on a clock). Clamped to 1–120.
 */
function fallbackMinutes(userType = 'agent') {
  const customer = userType === 'customer';
  const n = Number.parseInt(customer ? process.env.PUSH_CUSTOMER_FALLBACK_MIN : process.env.PUSH_FALLBACK_MIN, 10);
  if (!Number.isFinite(n)) return customer ? 10 : 5;
  return Math.min(120, Math.max(1, n));
}

const USER_TYPES = new Set(['agent', 'customer']);

let credentialCache = { source: null, value: null };

/** The service account ({ client_email, private_key, project_id }) or null. */
function serviceAccount() {
  const raw = String(process.env.FCM_SERVICE_ACCOUNT || '').trim();
  if (!raw) return null;
  if (credentialCache.source === raw) return credentialCache.value;
  let value = null;
  try {
    const json = raw.startsWith('{') ? raw : fs.readFileSync(raw, 'utf8');
    const parsed = JSON.parse(json);
    if (parsed.client_email && parsed.private_key && parsed.project_id) value = parsed;
    else console.error('[push] FCM_SERVICE_ACCOUNT lacks client_email / private_key / project_id');
  } catch (err) {
    console.error(`[push] FCM_SERVICE_ACCOUNT unreadable: ${err.message}`);
  }
  credentialCache = { source: raw, value };
  return value;
}

function pushConfigured() {
  return Boolean(serviceAccount());
}

// ---------------------------------------------------------------------------
// FCM transport (HTTP v1)
// ---------------------------------------------------------------------------

let tokenCache = { email: null, token: null, expiresAt: 0 };

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function accessToken(account, fetchImpl = fetch) {
  const now = Date.now();
  if (tokenCache.email === account.client_email && tokenCache.token && tokenCache.expiresAt - 60_000 > now) {
    return tokenCache.token;
  }
  const iat = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  }));
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.private_key);
  const assertion = `${header}.${claims}.${base64url(signature)}`;
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`OAuth token refused (${response.status}): ${JSON.stringify(body).slice(0, 200)}`);
  }
  tokenCache = { email: account.client_email, token: body.access_token, expiresAt: now + (body.expires_in || 3600) * 1000 };
  return body.access_token;
}

/** FCM's message for one device. `data` values must be strings. */
function fcmMessage(token, { title, body, url, notificationId, kind, audience = 'agent' }) {
  return {
    message: {
      token,
      notification: { title, body },
      data: {
        url: url || (audience === 'customer' ? '/compte/client' : '/compte/agent'),
        notificationId: String(notificationId ?? ''),
        kind: String(kind || ''),
        // Which inbox a tap opens in the one app (web lib/appBridge.js alertTarget).
        audience: audience === 'customer' ? 'customer' : 'agent',
      },
      android: { priority: 'high', notification: { channel_id: 'alerts', sound: 'default' } },
      apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
    },
  };
}

/** FCM's way of saying "this token will never work again". */
function isDeadTokenError(status, body) {
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  const code = details.find((d) => d?.errorCode)?.errorCode || body?.error?.status || '';
  if (status === 404 || code === 'UNREGISTERED') return true;
  // A malformed token: INVALID_ARGUMENT naming the registration token. Other
  // INVALID_ARGUMENTs are our own message's fault and must not revoke a phone.
  return status === 400 && code === 'INVALID_ARGUMENT' && /registration token/i.test(body?.error?.message || '');
}

/**
 * The real sender: { ok, dead, error }. Replaced in tests through
 * `_setTransport`.
 */
async function fcmTransport(token, payload, { fetchImpl = fetch } = {}) {
  const account = serviceAccount();
  if (!account) return { ok: false, dead: false, error: 'not-configured' };
  const bearer = await accessToken(account, fetchImpl);
  const response = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(fcmMessage(token, payload)),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) return { ok: true, dead: false, error: null };
  const body = await response.json().catch(() => ({}));
  return {
    ok: false,
    dead: isDeadTokenError(response.status, body),
    error: `${response.status} ${body?.error?.status || ''} ${String(body?.error?.message || '').slice(0, 120)}`.trim(),
  };
}

let transport = fcmTransport;
let transportIsReal = true;

/** verify-pipeline only. Pass null to restore FCM. */
function _setTransport(fn) {
  transport = fn || fcmTransport;
  transportIsReal = !fn;
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

let poolOverride = null;
/** verify-pipeline only. Pass null to restore the real pool. */
function _setPool(pool) {
  poolOverride = pool;
  tablesState = { ready: false, checkedAt: 0 };
}

function getPool() {
  if (poolOverride) return poolOverride;
  if (!postgres.isConfigured()) return null;
  return postgres.getPool();
}

let tablesState = { ready: false, checkedAt: 0 };

/** True once both tables exist; a "not yet" is re-asked at most once a minute. */
async function tablesAvailable(pool) {
  if (tablesState.ready) return true;
  if (Date.now() - tablesState.checkedAt < 60_000 && tablesState.checkedAt) return false;
  const { rows } = await pool.query(
    'SELECT to_regclass($1) IS NOT NULL AS a, to_regclass($2) IS NOT NULL AS b',
    TABLES.map((t) => `public.${t}`),
  );
  tablesState = { ready: Boolean(rows[0]?.a && rows[0]?.b), checkedAt: Date.now() };
  return tablesState.ready;
}

/** The agent gate shared with resolveAgentId: verified phone, not deleted. */
async function liveAgentId(pool, { agentId, phone }) {
  if (agentId != null && String(agentId).trim() !== '') {
    const { rows } = await pool.query(
      `SELECT id FROM agents WHERE id = $1 AND phone_verified_at IS NOT NULL AND deleted_at IS NULL`,
      [agentId],
    );
    return rows[0]?.id ?? null;
  }
  if (!phone) return null;
  return postgres.resolveAgentId(pool, phone);
}

/**
 * A customer account by id, or by phone (digits-only E.164, as
 * customers.phone stores it). Visit and request alerts know only the lead's
 * wa_id, so this is the Espace Client's own phone match (owner decision
 * 2026-11-06: no confirmed number required).
 */
async function liveCustomerId(pool, { customerId, phone }) {
  if (customerId != null && String(customerId).trim() !== '') {
    const { rows } = await pool.query('SELECT id FROM customers WHERE id = $1', [customerId]);
    return rows[0]?.id ?? null;
  }
  const digits = String(phone || '').replace(/\D/g, '');
  if (!/^\d{7,15}$/.test(digits)) return null;
  const { rows } = await pool.query('SELECT id FROM customers WHERE phone = $1 LIMIT 1', [digits]);
  return rows[0]?.id ?? null;
}

/**
 * Whether this person left push on for this kind of alert
 * (notification_preferences; no row = on). A missing table reads as on.
 */
async function categoryEnabled(pool, userType, userId, category) {
  if (!category) return true;
  try {
    const { rows } = await pool.query(
      `SELECT push_enabled FROM notification_preferences
        WHERE user_type = $1 AND user_id = $2 AND category = $3`,
      [userType, userId, category],
    );
    return rows[0] ? rows[0].push_enabled !== false : true;
  } catch (err) {
    if (err?.code === '42P01') return true;
    throw err;
  }
}

function clip(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Only a site path: the app opens it inside lukkaplace.com. */
function safePath(url) {
  const text = String(url || '').trim();
  return text.startsWith('/') && !text.startsWith('//') ? text.slice(0, 500) : null;
}

function suffix(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d ? `…${d.slice(-4)}` : 'no phone';
}

// ---------------------------------------------------------------------------
// The push half
// ---------------------------------------------------------------------------

/**
 * Record the alert and push it. Never throws.
 * @returns {Promise<{pushed: boolean, notificationId: number|null, reason: string}>}
 */
async function tryPush({ userType = 'agent', agentId, customerId, phone, kind, category, refId, title, body, url, urgent, fallback }) {
  if (!pushEnabled()) return { pushed: false, notificationId: null, reason: 'off' };
  if (!USER_TYPES.has(userType)) return { pushed: false, notificationId: null, reason: 'bad-user-type' };
  try {
    const pool = getPool();
    if (!pool) return { pushed: false, notificationId: null, reason: 'no-database' };
    if (!(await tablesAvailable(pool))) return { pushed: false, notificationId: null, reason: 'no-tables' };

    const userId = userType === 'customer'
      ? await liveCustomerId(pool, { customerId, phone })
      : await liveAgentId(pool, { agentId, phone });
    if (!userId) return { pushed: false, notificationId: null, reason: `no-${userType}` };
    if (!(await categoryEnabled(pool, userType, userId, category))) {
      return { pushed: false, notificationId: null, reason: 'category-off' };
    }

    const cleanTitle = clip(title, TITLE_MAX) || 'Lukka Place';
    const cleanBody = clip(body, BODY_MAX);
    const path = safePath(url);
    const { rows: [row] } = await pool.query(
      `INSERT INTO notifications (user_type, user_id, kind, ref_id, title, body, url, urgent)
       VALUES ($8, $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [userId, kind, refId == null ? null : String(refId).slice(0, 60), cleanTitle, cleanBody, path, Boolean(urgent), userType],
    );
    const notificationId = row.id;

    const { rows: devices } = await pool.query(
      `SELECT id, fcm_token FROM push_devices
        WHERE user_type = $2 AND user_id = $1 AND revoked_at IS NULL
        ORDER BY last_seen_at DESC LIMIT ${MAX_DEVICES}`,
      [userId, userType],
    );
    const finish = async (result) => {
      await pool.query('UPDATE notifications SET push_result = $2 WHERE id = $1', [notificationId, result.slice(0, 200)]);
    };
    if (!devices.length) {
      await finish('no-device');
      return { pushed: false, notificationId, reason: 'no-device' };
    }
    if (transportIsReal && !pushConfigured()) {
      await finish('not-configured');
      return { pushed: false, notificationId, reason: 'not-configured' };
    }

    const payload = { title: cleanTitle, body: cleanBody, url: path, notificationId, kind, audience: userType };
    const outcomes = await Promise.all(devices.map(async (device) => {
      try {
        return { device, ...(await transport(device.fcm_token, payload)) };
      } catch (err) {
        return { device, ok: false, dead: false, error: err.message };
      }
    }));
    const dead = outcomes.filter((o) => o.dead).map((o) => o.device.id);
    if (dead.length) {
      await pool.query(
        `UPDATE push_devices SET revoked_at = NOW(), revoked_reason = 'fcm: token no longer valid'
          WHERE id = ANY($1::bigint[]) AND revoked_at IS NULL`,
        [dead],
      );
    }
    const delivered = outcomes.filter((o) => o.ok).length;
    if (!delivered) {
      const firstError = outcomes.find((o) => o.error)?.error || 'refused';
      await finish(`failed 0/${devices.length}: ${firstError}`);
      console.warn(`[push] ${kind} #${notificationId} for ${userType} #${userId}: no device accepted (${firstError})`);
      return { pushed: false, notificationId, reason: 'push-failed' };
    }

    const withFallback = Boolean(urgent && fallback);
    await pool.query(
      `UPDATE notifications
          SET push_sent_at = NOW(), push_result = $2,
              fallback = $3::jsonb,
              fallback_due_at = CASE WHEN $3::jsonb IS NULL THEN NULL ELSE NOW() + make_interval(mins => $4) END
        WHERE id = $1`,
      [notificationId, `sent ${delivered}/${devices.length}`, withFallback ? JSON.stringify(fallback) : null, fallbackMinutes(userType)],
    );
    console.log(
      `[push] ${kind} #${notificationId} pushed to ${userType} #${userId} (${delivered}/${devices.length} device(s))` +
        (withFallback ? `; WhatsApp copy in ${fallbackMinutes(userType)} min if unread` : ''),
    );
    return { pushed: true, notificationId, userId, reason: 'pushed' };
  } catch (err) {
    console.error(`[push] ${kind} for ${suffix(phone)}: ${err.message} — WhatsApp instead`);
    return { pushed: false, notificationId: null, reason: 'error' };
  }
}

async function noteWhatsApp(notificationId, text) {
  if (!notificationId) return;
  try {
    await getPool()?.query(
      'UPDATE notifications SET whatsapp_fallback_at = COALESCE(whatsapp_fallback_at, NOW()), whatsapp_result = $2 WHERE id = $1',
      [notificationId, String(text).slice(0, 200)],
    );
  } catch (err) {
    console.error(`[push] could not note WhatsApp result on #${notificationId}: ${err.message}`);
  }
}

/**
 * Push first, WhatsApp when the push did not happen.
 *
 * @param {Object} params
 * @param {'agent'|'customer'} [params.userType]  Default 'agent'.
 * @param {number|string} [params.agentId]  Postgres agents.id, when the caller has it.
 * @param {number|string} [params.customerId]  Postgres customers.id, when the caller has it.
 * @param {string} [params.phone]           The person's number; resolves the account when no id.
 * @param {string} [params.category]        notification_preferences category; off → WhatsApp only.
 * @param {string} params.kind              'viewing_request', 'enquiry', 'chat', 'listing_verdict'…
 * @param {string|number} [params.refId]    The thing the alert is about (request id, lead id…).
 * @param {string} params.title
 * @param {string} params.body
 * @param {string} [params.url]             A site path the tap opens, e.g. '/compte/agent/demandes?visite=12'.
 * @param {boolean} [params.urgent]         Also WhatsApp it when unread after PUSH_FALLBACK_MIN.
 * @param {Object} [params.fallback]        JSON the kind's FALLBACK_SENDERS entry needs later.
 * @param {() => Promise<any>} params.sendWhatsApp  Today's send; throws as it always did.
 * @returns {Promise<{pushed: true, notificationId: number} | {pushed: false, whatsapp: any, reason: string}>}
 */
async function pushFirst(params) {
  const outcome = await tryPush(params);
  if (outcome.pushed) return { pushed: true, notificationId: outcome.notificationId };
  try {
    const whatsapp = await params.sendWhatsApp();
    await noteWhatsApp(outcome.notificationId, `sent now (${outcome.reason})`);
    return { pushed: false, whatsapp, reason: outcome.reason };
  } catch (err) {
    await noteWhatsApp(outcome.notificationId, `failed now (${outcome.reason}): ${err.message}`);
    throw err;
  }
}

/** Record and push only — for alerts with no WhatsApp copy at all. Never throws. */
async function pushOnly(params) {
  return tryPush({ ...params, urgent: false, fallback: null });
}

// ---------------------------------------------------------------------------
// The urgent fallback
// ---------------------------------------------------------------------------

/**
 * kind → the module's own WhatsApp send for a late copy. Lazy requires: those
 * modules require this one. Each returns a short result text, or throws.
 */
const FALLBACK_SENDERS = {
  viewing_request: (data) => require('./viewingNotifications').sendViewingAlertFallback(data),
  enquiry: (data) => require('./agentEnquiryAlert').sendEnquiryAlertFallback(data),
  // Customer visit alerts (viewingNotifications.tellCustomer): every kind shares one sender.
  visit_confirmed: (data) => require('./viewingNotifications').sendCustomerVisitFallback(data),
  visit_proposal: (data) => require('./viewingNotifications').sendCustomerVisitFallback(data),
  visit_unavailable: (data) => require('./viewingNotifications').sendCustomerVisitFallback(data),
  visit_cancelled: (data) => require('./viewingNotifications').sendCustomerVisitFallback(data),
  visit_sla: (data) => require('./viewingNotifications').sendCustomerVisitFallback(data),
  // A plain WhatsApp text, for alerts that come from web through POST /admin/push.
  customer_text: async (data) => {
    if (!data.phone || !data.text) return 'skipped: nothing to send';
    await require('./chakra').sendWhatsAppMessage(String(data.phone).replace(/\D/g, ''), data.text, { previewUrl: true });
    return 'sent via session';
  },
};

/** verify-pipeline only. */
function _setFallbackSender(kind, fn) {
  if (fn) FALLBACK_SENDERS[kind] = fn;
  else delete FALLBACK_SENDERS[kind];
}

/**
 * Send the WhatsApp copy of urgent alerts still unread after their delay.
 * Each row is claimed before its send, so a second process (or tick) never
 * repeats it.
 */
async function runFallbackSweep() {
  const summary = { due: 0, sent: 0, skipped: 0, failed: 0 };
  if (!pushEnabled()) return { ...summary, off: true };
  const pool = getPool();
  if (!pool || !(await tablesAvailable(pool))) return { ...summary, unavailable: true };

  const { rows } = await pool.query(
    `UPDATE notifications SET whatsapp_fallback_at = NOW()
      WHERE id IN (
        SELECT id FROM notifications
         WHERE fallback_due_at <= NOW()
           AND fallback_due_at > NOW() - make_interval(hours => ${FALLBACK_MAX_AGE_HOURS})
           AND whatsapp_fallback_at IS NULL AND read_at IS NULL AND fallback IS NOT NULL
         ORDER BY fallback_due_at
         LIMIT ${FALLBACK_BATCH}
         FOR UPDATE SKIP LOCKED)
      RETURNING id, kind, user_id, fallback`,
  );
  summary.due = rows.length;
  for (const row of rows) {
    // `fallback.sender` names the WhatsApp send when it is not the kind's own.
    const sender = FALLBACK_SENDERS[row.fallback?.sender || row.kind];
    let result;
    if (!sender) {
      result = 'skipped: no WhatsApp sender for this kind';
      summary.skipped += 1;
    } else {
      try {
        result = String((await sender(row.fallback || {})) || 'sent');
        if (result.startsWith('skipped')) summary.skipped += 1;
        else summary.sent += 1;
      } catch (err) {
        result = `failed: ${err.message}`;
        summary.failed += 1;
      }
    }
    console.log(`[push] fallback ${row.kind} #${row.id} (agent #${row.user_id}): ${result}`);
    await pool.query('UPDATE notifications SET whatsapp_result = $2 WHERE id = $1', [row.id, result.slice(0, 200)]);
  }
  return summary;
}

const pushFallbackJob = {
  name: 'push-fallback',
  // Every tick is cheap: one indexed UPDATE that matches nothing almost always.
  shouldRun: () => pushEnabled(),
  run: () => runFallbackSweep(),
};

module.exports = {
  pushFirst,
  pushOnly,
  tryPush,
  runFallbackSweep,
  pushFallbackJob,
  pushEnabled,
  pushConfigured,
  fallbackMinutes,
  // Exposed for scripts/verify-pipeline.js.
  fcmMessage,
  fcmTransport,
  isDeadTokenError,
  safePath,
  _setTransport,
  _setPool,
  _setFallbackSender,
  FALLBACK_SENDERS,
};
