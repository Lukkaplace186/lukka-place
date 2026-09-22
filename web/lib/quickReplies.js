import 'server-only';
import { getPool } from './db';
import {
  DEFAULT_QUICK_REPLIES,
  QUICK_REPLY_MAX_PER_AGENT,
  validateQuickReply,
} from './quickReplyRules';

/**
 * Storage for an agent's quick replies (`agent_quick_replies`,
 * migrations/20260922_agent_quick_replies.sql). Rules and rendering are in
 * lib/quickReplyRules.js.
 *
 * Copy-on-first-edit: an agent with no row sees DEFAULT_QUICK_REPLIES. The
 * first write of any kind copies those defaults into the agent's own rows
 * (in the same transaction as the write), then applies it — so editing one
 * default keeps the other four, and nothing is ever inserted for an agent who
 * never touched the feature. Deletion is a soft delete, so an agent who
 * removed everything keeps an empty list rather than getting the defaults
 * back.
 *
 * Degrades before the migration runs: a missing table (42P01) or column
 * (42703) reads as "defaults, not editable yet", never a 500.
 */

const MISSING_SCHEMA = new Set(['42P01', '42703']);

export function isMissingSchema(err) {
  return MISSING_SCHEMA.has(err?.code);
}

function defaultTemplates() {
  return DEFAULT_QUICK_REPLIES.map((d) => ({
    id: `default:${d.key}`,
    title: d.title,
    body: d.body,
    isDefault: true,
    defaultKey: d.key,
  }));
}

function agentIdOf(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * @returns {Promise<{templates: Array<{id: string, title: string, body: string, isDefault: boolean, defaultKey: string|null}>,
 *   customised: boolean, editable: boolean}>}
 */
export async function listQuickReplies(agentId) {
  const id = agentIdOf(agentId);
  if (!id) return { templates: defaultTemplates(), customised: false, editable: false };
  try {
    const { rows } = await getPool().query(
      `SELECT id, title, body, default_key, archived_at
       FROM agent_quick_replies
       WHERE agent_id = $1
       ORDER BY position ASC, id ASC`,
      [id],
    );
    if (rows.length === 0) return { templates: defaultTemplates(), customised: false, editable: true };
    return {
      templates: rows
        .filter((row) => !row.archived_at)
        .map((row) => ({
          id: String(row.id),
          title: row.title,
          body: row.body,
          isDefault: false,
          defaultKey: row.default_key || null,
        })),
      customised: true,
      editable: true,
    };
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    return { templates: defaultTemplates(), customised: false, editable: false };
  }
}

/*
 * Copies the defaults in, only for an agent with no row at all. Two tabs
 * racing both pass the NOT EXISTS; the partial unique index on
 * (agent_id, default_key) turns the second copy into a no-op.
 */
const MATERIALISE_SQL = `
  INSERT INTO agent_quick_replies (agent_id, title, body, position, default_key)
  SELECT $1, d.title, d.body, d.position, d.key
  FROM jsonb_to_recordset($2::jsonb) AS d(key text, title text, body text, position int)
  WHERE NOT EXISTS (SELECT 1 FROM agent_quick_replies WHERE agent_id = $1)
  ON CONFLICT (agent_id, default_key) WHERE default_key IS NOT NULL DO NOTHING
`;

function materialisePayload() {
  return JSON.stringify(DEFAULT_QUICK_REPLIES.map((d, index) => ({ key: d.key, title: d.title, body: d.body, position: index + 1 })));
}

/** Resolves a template id from the client: `default:<key>` or a numeric row id. Anything else is null. */
function parseTemplateId(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { kind: 'new' };
  const defaultMatch = /^default:([a-z][a-z0-9_]{1,40})$/.exec(value);
  if (defaultMatch) {
    return DEFAULT_QUICK_REPLIES.some((d) => d.key === defaultMatch[1]) ? { kind: 'default', key: defaultMatch[1] } : null;
  }
  if (/^\d{1,18}$/.test(value)) return { kind: 'row', id: value };
  return null;
}

async function inTransaction(work) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query(result?.ok ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (isMissingSchema(err)) return { ok: false, errorKey: 'agent.quickReplies.errors.unavailable' };
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Creates (no id) or updates one of the agent's templates. Ownership is in
 * every WHERE clause.
 *
 * @returns {Promise<{ok: true} | {ok: false, errorKey: string}>}
 */
export async function saveQuickReply(agentId, { id, title, body }) {
  const owner = agentIdOf(agentId);
  if (!owner) return { ok: false, errorKey: 'agent.quickReplies.errors.notFound' };
  const valid = validateQuickReply({ title, body });
  if (!valid.ok) return valid;
  const target = parseTemplateId(id);
  if (!target) return { ok: false, errorKey: 'agent.quickReplies.errors.notFound' };

  return inTransaction(async (client) => {
    await client.query(MATERIALISE_SQL, [owner, materialisePayload()]);

    if (target.kind === 'new') {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n, COALESCE(MAX(position), 0)::int AS last
         FROM agent_quick_replies WHERE agent_id = $1 AND archived_at IS NULL`,
        [owner],
      );
      if ((rows[0]?.n ?? 0) >= QUICK_REPLY_MAX_PER_AGENT) {
        return { ok: false, errorKey: 'agent.quickReplies.errors.tooMany' };
      }
      await client.query(
        `INSERT INTO agent_quick_replies (agent_id, title, body, position) VALUES ($1, $2, $3, $4)`,
        [owner, valid.title, valid.body, (rows[0]?.last ?? 0) + 1],
      );
      return { ok: true };
    }

    const { rowCount } =
      target.kind === 'default'
        ? await client.query(
            `UPDATE agent_quick_replies SET title = $3, body = $4, updated_at = NOW()
             WHERE agent_id = $1 AND default_key = $2 AND archived_at IS NULL`,
            [owner, target.key, valid.title, valid.body],
          )
        : await client.query(
            `UPDATE agent_quick_replies SET title = $3, body = $4, updated_at = NOW()
             WHERE agent_id = $1 AND id = $2 AND archived_at IS NULL`,
            [owner, target.id, valid.title, valid.body],
          );
    return rowCount > 0 ? { ok: true } : { ok: false, errorKey: 'agent.quickReplies.errors.notFound' };
  });
}

/** Soft-deletes one template (copying the defaults in first, like any write). */
export async function deleteQuickReply(agentId, id) {
  const owner = agentIdOf(agentId);
  const target = parseTemplateId(id);
  if (!owner || !target || target.kind === 'new') return { ok: false, errorKey: 'agent.quickReplies.errors.notFound' };

  return inTransaction(async (client) => {
    await client.query(MATERIALISE_SQL, [owner, materialisePayload()]);
    const { rowCount } =
      target.kind === 'default'
        ? await client.query(
            `UPDATE agent_quick_replies SET archived_at = NOW(), updated_at = NOW()
             WHERE agent_id = $1 AND default_key = $2 AND archived_at IS NULL`,
            [owner, target.key],
          )
        : await client.query(
            `UPDATE agent_quick_replies SET archived_at = NOW(), updated_at = NOW()
             WHERE agent_id = $1 AND id = $2 AND archived_at IS NULL`,
            [owner, target.id],
          );
    return rowCount > 0 ? { ok: true } : { ok: false, errorKey: 'agent.quickReplies.errors.notFound' };
  });
}

/**
 * The agent's own listings with exactly the facts a template can quote
 * (lib/quickReplyRules.js's quickReplyFacts). Every listing they own, closed
 * ones included — "Déjà loué" is precisely a reply about a listing that is
 * off the market. `is_public` is the public gate (status = 1 AND
 * approve_status = 1), which is what decides whether {link} can be offered.
 * advance/commission are read through jsonb so this keeps working on a
 * database where those columns have not been added.
 */
export async function getQuickReplyListings(agentId) {
  const id = agentIdOf(agentId);
  if (!id) return [];
  const { rows } = await getPool().query(
    `SELECT p.id, pc.title, p.price, p.purpose, p.price_period, p.quartier, p.deposit_months,
            to_jsonb(p) ->> 'advance_months' AS advance_months,
            to_jsonb(p) ->> 'commission_months' AS commission_months,
            (p.status = 1 AND p.approve_status = 1) AS is_public,
            (
              SELECT ac.name FROM property_amenities pa
              JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = 20
              WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
              LIMIT 1
            ) AS commune
     FROM properties p
     JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
     WHERE p.agent_id = $1
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT 300`,
    [id],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title || '',
    price: row.price == null ? null : Number(row.price),
    purpose: row.purpose || null,
    price_period: row.price_period || null,
    quartier: row.quartier || null,
    commune: row.commune || null,
    deposit_months: row.deposit_months,
    advance_months: row.advance_months,
    commission_months: row.commission_months,
    is_public: row.is_public === true,
  }));
}
