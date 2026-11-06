/**
 * services/chatNotify.js
 *
 * WhatsApp alerts for the site's Messagerie (web/CLAUDE.md, "Messagerie";
 * tables in migrations/20261105_chat.sql). The conversation lives in
 * Postgres and is read on the site; this job only tells the other person
 * that something is waiting there, with the link.
 *
 * WHEN. Scheduler job `chat-notify`, every 2 minutes. A side is alerted when
 * a message from the other side has been unread for CHAT_NOTIFY_DELAY_MIN
 * (3) minutes — someone with the conversation open reads it within seconds
 * (the page marks it read), so they are never pinged about what they are
 * looking at.
 *
 * ONCE PER UNREAD RUN. `*_notified_at` is stamped when an alert is claimed.
 * A new alert goes out only when the FIRST unread message is newer than that
 * stamp, i.e. the person read everything since and a new run started. Ten
 * messages in a row produce one alert, not ten. The stamp is claimed in the
 * UPDATE before sending (two overlapping runs cannot both send) and kept
 * even when the send fails: a refused number is not retried every 2 minutes.
 *
 * WHO. Agents: phone verified, account not deleted. Customers: phone
 * verified and not opted out of WhatsApp alerts. Blocked conversations
 * never alert. Unread runs older than 7 days are left alone (nobody wants a
 * "new message" about last month).
 *
 * QUIET HOURS. Nothing between CHAT_NOTIFY_QUIET_FROM (21) and
 * CHAT_NOTIFY_QUIET_TO (7), Kinshasa time: the alert goes at 7 instead,
 * since the condition still holds then.
 *
 * TEXT OR TEMPLATE. Inside the recipient's 24 h window (services/
 * sessionWindow.js) the text, which carries its own link; outside it the
 * approved template when one is set (CHAT_AGENT_TEMPLATE /
 * CHAT_CUSTOMER_TEMPLATE, DYNAMIC link button = the thread id); else the
 * text anyway, which Meta accepts and will not deliver — logged as such.
 * CHAT_NOTIFY=off stops the job.
 */

const chakra = require('./chakra');
const { insideSessionWindow } = require('./sessionWindow');

const JOB_NAME = 'chat-notify';
const SWEEP_INTERVAL_MS = 2 * 60 * 1000;
const MAX_PER_SWEEP = 50;
const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');
/** Kinshasa is UTC+1 all year. */
const KINSHASA_OFFSET_H = 1;
/** agent_infos / property_contents French rows. */
const FRENCH = 20;

const PARAM_LIMITS = { name: 60, other: 80, subject: 120, message: 300 };

function intEnv(name, fallback) {
  const n = Number.parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function notifyEnabled() {
  return String(process.env.CHAT_NOTIFY || '').trim().toLowerCase() !== 'off';
}

function delayMinutes() {
  return Math.max(1, intEnv('CHAT_NOTIFY_DELAY_MIN', 3));
}

/** True inside the quiet hours (Kinshasa), which may wrap midnight. */
function inQuietHours(now = new Date()) {
  const from = intEnv('CHAT_NOTIFY_QUIET_FROM', 21) % 24;
  const to = intEnv('CHAT_NOTIFY_QUIET_TO', 7) % 24;
  if (from === to) return false;
  const hour = (now.getUTCHours() + KINSHASA_OFFSET_H) % 24;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

function templateFor(role) {
  return String(process.env[role === 'agent' ? 'CHAT_AGENT_TEMPLATE' : 'CHAT_CUSTOMER_TEMPLATE'] || '').trim();
}

function templateLanguage() {
  return String(process.env.CHAT_TEMPLATE_LANG || 'fr').trim() || 'fr';
}

/** Meta refuses a variable with a newline, a tab or four spaces in a row, and an empty one. */
function oneLine(value, max, fallback) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** "Grace Kabila" → "Grace K."; a phone number or nothing → null (same rule as web lib/chatRules.js). */
function shortPersonName(fullName) {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || /^\+?\d{7,15}$/.test(parts.join(''))) return null;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

function firstName(value) {
  const name = String(value ?? '').trim();
  if (!name || /^\+?\d{7,15}$/.test(name.replace(/\s+/g, ''))) return null;
  return name.split(/\s+/)[0];
}

/**
 * Who should hear about which conversation. One query per recipient side:
 * `$1` is the delay in minutes. The column names come from this fixed table,
 * never from input.
 */
const SIDES = {
  agent: {
    readCol: 'agent_last_read_id',
    notifiedCol: 'agent_notified_at',
    from: 'customer',
    recipient: `
      JOIN agents a ON a.id = t.agent_id
       AND a.deleted_at IS NULL AND a.phone_verified_at IS NOT NULL AND NULLIF(TRIM(a.phone), '') IS NOT NULL`,
    phone: 'a.phone',
  },
  customer: {
    readCol: 'customer_last_read_id',
    notifiedCol: 'customer_notified_at',
    from: 'agent',
    recipient: `
      JOIN agents a ON a.id = t.agent_id`,
    phone: 'c.phone',
    extra: `AND c.phone_verified_at IS NOT NULL
            AND (to_jsonb(c) ->> 'whatsapp_alerts_opted_out_at') IS NULL`,
  },
};

function dueSql(role) {
  const s = SIDES[role];
  return `
    SELECT t.id, t.property_id,
           ${s.phone} AS phone,
           c.full_name AS customer_name,
           (SELECT ai.first_name FROM agent_infos ai WHERE ai.agent_id = a.id
             ORDER BY (ai.language_id = ${FRENCH}) DESC, ai.language_id LIMIT 1) AS agent_first_name,
           NULLIF(TRIM(a.agency_name), '') AS agency_name,
           (SELECT pc.title FROM property_contents pc WHERE pc.property_id = t.property_id AND pc.language_id = ${FRENCH} LIMIT 1) AS listing_title,
           u.first_unread_at, u.unread_count,
           (SELECT m2.kind || '|' || COALESCE(m2.body, '') FROM chat_messages m2
             WHERE m2.thread_id = t.id AND m2.id > t.${s.readCol} AND m2.sender_role = '${s.from}' AND m2.deleted_at IS NULL
             ORDER BY m2.id DESC LIMIT 1) AS last_message
      FROM chat_threads t
      JOIN customers c ON c.id = t.customer_id
      ${s.recipient}
      JOIN LATERAL (
        SELECT MIN(m.created_at) AS first_unread_at, COUNT(*)::int AS unread_count
          FROM chat_messages m
         WHERE m.thread_id = t.id AND m.id > t.${s.readCol} AND m.sender_role = '${s.from}' AND m.deleted_at IS NULL
      ) u ON u.first_unread_at IS NOT NULL
     WHERE t.blocked_at IS NULL
       ${s.extra || ''}
       AND u.first_unread_at <= NOW() - make_interval(mins => $1::int)
       AND u.first_unread_at > NOW() - INTERVAL '7 days'
       AND (t.${s.notifiedCol} IS NULL OR t.${s.notifiedCol} < u.first_unread_at)
     ORDER BY u.first_unread_at
     LIMIT ${MAX_PER_SWEEP}`;
}

/** Claim one alert: only the run that moves the stamp sends. */
function claimSql(role) {
  const col = SIDES[role].notifiedCol;
  return `UPDATE chat_threads SET ${col} = NOW()
           WHERE id = $1 AND (${col} IS NULL OR ${col} < $2)
           RETURNING id`;
}

/** The latest unread message, as the alert quotes it. */
function excerptOf(lastMessage) {
  const raw = String(lastMessage || '');
  const bar = raw.indexOf('|');
  const kind = bar >= 0 ? raw.slice(0, bar) : 'text';
  const body = bar >= 0 ? raw.slice(bar + 1) : raw;
  if (kind === 'listing' && !body.trim()) return 'Bien partagé';
  return oneLine(body, PARAM_LIMITS.message, 'Nouveau message');
}

/**
 * The alert for one due row, both forms. Pure.
 *
 * @returns {{to: string, text: string, bodyParams: string[], link: string, threadId: number}}
 */
function buildAlert(role, row) {
  const threadId = Number(row.id);
  const subject = oneLine(row.listing_title, PARAM_LIMITS.subject, role === 'agent' ? 'votre profil' : 'votre demande');
  const excerpt = excerptOf(row.last_message);
  const more = Number(row.unread_count) > 1 ? ` (${row.unread_count} messages)` : '';
  const customer = shortPersonName(row.customer_name) || 'Un client';
  const agentName = firstName(row.agent_first_name) || row.agency_name || 'Votre agent';

  if (role === 'agent') {
    const link = `${SITE_URL}/compte/agent/messages/${threadId}`;
    return {
      threadId,
      to: String(row.phone || '').replace(/\D/g, ''),
      link,
      text:
        `Nouveau message de ${customer} sur Lukka Place${more}, au sujet de : ${subject}\n`
        + `« ${excerpt} »\n\n`
        + `Répondez-lui ici : ${link}`,
      bodyParams: [
        oneLine(firstName(row.agent_first_name) || row.agency_name, PARAM_LIMITS.name, 'cher partenaire'),
        oneLine(customer, PARAM_LIMITS.other, 'Un client'),
        subject,
        excerpt,
      ],
    };
  }
  const link = `${SITE_URL}/messages/${threadId}`;
  return {
    threadId,
    to: String(row.phone || '').replace(/\D/g, ''),
    link,
    text:
      `${agentName} vous a répondu sur Lukka Place${more}, au sujet de : ${subject}\n`
      + `« ${excerpt} »\n\n`
      + `Lire et répondre : ${link}`,
    bodyParams: [
      oneLine(firstName(row.customer_name), PARAM_LIMITS.name, 'Bonjour'),
      oneLine(agentName, PARAM_LIMITS.other, 'Votre agent'),
      subject,
      excerpt,
    ],
  };
}

/**
 * Sends one alert: the text inside the 24 h window, the template outside it
 * when one is configured, else the text.
 *
 * @returns {Promise<{via: 'session'|'template', outsideWindow: boolean}>}
 */
async function deliverAlert(role, alert, { now = new Date(), client = chakra } = {}) {
  const outsideWindow = !insideSessionWindow(alert.to, now);
  const name = templateFor(role);
  if (outsideWindow && client.templateConfigured(name)) {
    try {
      await client.sendTemplate(alert.to, name, {
        languageCode: templateLanguage(),
        bodyParams: alert.bodyParams,
        urlButton: String(alert.threadId),
      });
      return { via: 'template', outsideWindow };
    } catch (err) {
      console.warn(`[chat-notify] ${role} #${alert.threadId}: template '${name}' failed, sending text: ${err.message}`);
    }
  }
  await client.sendWhatsAppMessage(alert.to, alert.text, { previewUrl: true });
  return { via: 'session', outsideWindow };
}

/**
 * One sweep. Injectable for verify-pipeline: `pool` (Postgres), `send`.
 *
 * @returns {Promise<{skipped?: string, sent: number, failed: number, claimed: number}>}
 */
async function runChatNotifySweep({ now = new Date(), pool, send = deliverAlert } = {}) {
  const result = { sent: 0, failed: 0, claimed: 0 };
  if (!notifyEnabled()) return { ...result, skipped: 'disabled' };
  if (inQuietHours(now)) return { ...result, skipped: 'quiet-hours' };

  let db = pool;
  if (!db) {
    // eslint-disable-next-line global-require
    const postgres = require('./postgres');
    if (!postgres.isConfigured()) return { ...result, skipped: 'no-postgres' };
    db = postgres.getPool();
  }

  for (const role of ['agent', 'customer']) {
    let rows;
    try {
      ({ rows } = await db.query(dueSql(role), [delayMinutes()]));
    } catch (err) {
      if (err?.code === '42P01') return { ...result, skipped: 'no-chat-tables' };
      throw err;
    }
    for (const row of rows) {
      const alert = buildAlert(role, row);
      if (!/^\d{7,15}$/.test(alert.to)) continue;
      const { rows: claimed } = await db.query(claimSql(role), [alert.threadId, row.first_unread_at]);
      if (!claimed[0]) continue;
      result.claimed += 1;
      try {
        const how = await send(role, alert, { now });
        result.sent += 1;
        console.log(
          `[chat-notify] ${role} …${alert.to.slice(-4)} told of thread #${alert.threadId} via ${how.via}`
            + `${how.via === 'session' && how.outsideWindow ? ' (outside the 24 h window: probably not delivered)' : ''}`,
        );
      } catch (err) {
        result.failed += 1;
        console.warn(`[chat-notify] ${role} #${alert.threadId}: send failed: ${err.message}`);
      }
    }
  }
  return result;
}

let lastSweepAt = 0;

const chatNotifyJob = {
  name: JOB_NAME,
  shouldRun: (now = new Date()) => notifyEnabled() && now.getTime() - lastSweepAt >= SWEEP_INTERVAL_MS,
  run: async () => {
    lastSweepAt = Date.now();
    return runChatNotifySweep();
  },
};

module.exports = {
  JOB_NAME,
  SWEEP_INTERVAL_MS,
  notifyEnabled,
  inQuietHours,
  dueSql,
  claimSql,
  buildAlert,
  deliverAlert,
  runChatNotifySweep,
  chatNotifyJob,
};
