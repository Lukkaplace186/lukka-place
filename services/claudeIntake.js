'use strict';

/**
 * services/claudeIntake.js
 *
 * The WhatsApp listing read on Anthropic's Claude (2026-11-21, owner: move
 * intake to Claude Sonnet 5.5 for cost, gpt-4o as the backup).
 *
 * services/openai.js builds ONE request — its SYSTEM_PROMPT, the draft as a
 * second system message, the history, the user turn with image parts — in
 * OpenAI's shape. This module sends that same request to Claude and returns an
 * OpenAI-shaped completion, so parseMessage, its normalisers and the tests
 * see no difference. Measured before the switch (scripts/eval-intake-models.js,
 * 64 real messages): Sonnet 5.5 ~1.05 ¢ a message against gpt-4o ~2.2 ¢.
 *
 * Why not Claude's strict JSON mode: it accepts at most 16 nullable/union
 * fields and the intake schema has ~50, so the request is refused (400). The
 * schema goes into the cached system prompt instead and the answer must be
 * bare JSON; it is parsed here and every key the schema requires is filled
 * (null, [], false) so a missing key can never reach the database as
 * undefined. Anything unusable THROWS — services/openai.js then asks gpt-4o.
 *
 * Env, read at call time:
 *   INTAKE_PROVIDER=claude      Claude reads first, gpt-4o on any failure
 *                               (unset / openai = gpt-4o only, as before)
 *   INTAKE_SHADOW=claude        gpt-4o answers; Claude reads the same message
 *                               in the background and only the comparison is
 *                               stored (table intake_shadow) — the trial week
 *   INTAKE_CLAUDE_MODEL         default claude-sonnet-5-5
 *   INTAKE_CLAUDE_EFFORT        default low (measured; thinking is always on)
 *   ANTHROPIC_API_KEY           without it Claude is skipped, never an error
 */

const db = require('./db');

const DEFAULT_MODEL = 'claude-sonnet-5-5';

/** US$ per million tokens: [input, cache read, cache write (1 h), output]. Anthropic list prices, 2026-11-03. */
const CLAUDE_PRICES = [
  ['claude-sonnet-5-5', [2, 0.10, 4, 10]],
  ['claude-haiku-5-5', [0.10, 0.01, 0.20, 0.50]],
  ['claude-opus-5-5', [4, 0.20, 8, 20]],
];

db.db.exec(`
  CREATE TABLE IF NOT EXISTS intake_shadow (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT NOT NULL,
    model        TEXT,
    text_excerpt TEXT,
    agree        INTEGER,
    diff_fields  TEXT,
    reference    TEXT,
    shadow       TEXT,
    error        TEXT,
    cost_usd     REAL,
    ms           INTEGER
  );
`);

function env(name) {
  return String(process.env[name] || '').trim();
}

function provider() {
  return env('INTAKE_PROVIDER').toLowerCase() === 'claude' ? 'claude' : 'openai';
}

function shadowEnabled() {
  return env('INTAKE_SHADOW').toLowerCase() === 'claude';
}

function claudeModel() {
  return env('INTAKE_CLAUDE_MODEL') || DEFAULT_MODEL;
}

function configured() {
  return Boolean(env('ANTHROPIC_API_KEY')) || Boolean(testClient);
}

let client = null;
let testClient = null;
/** scripts/verify-pipeline.js stands in for Anthropic here. */
function setClientForTests(fake) {
  testClient = fake;
}

function getClient() {
  if (testClient) return testClient;
  if (!client) {
    // eslint-disable-next-line global-require
    const Anthropic = require('@anthropic-ai/sdk').default;
    client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') });
  }
  return client;
}

/** OpenAI's strict nullable enum ({type: ['string','null'], enum: [..., null]}) written as anyOf. */
function schemaForPrompt(node) {
  if (Array.isArray(node)) return node.map(schemaForPrompt);
  if (!node || typeof node !== 'object') return node;
  const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, schemaForPrompt(v)]));
  if (Array.isArray(out.type) && out.type.includes('null') && Array.isArray(out.enum)) {
    const { type, enum: values, ...rest } = out;
    const types = type.filter((t) => t !== 'null');
    return {
      ...rest,
      anyOf: [{ type: types.length === 1 ? types[0] : types, enum: values.filter((v) => v !== null) }, { type: 'null' }],
    };
  }
  return out;
}

function claudeContent(content) {
  if (typeof content === 'string') return content;
  return content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    const url = part.image_url?.url || '';
    const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
    return m
      ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }
      : { type: 'image', source: { type: 'url', url } };
  });
}

/**
 * The value the schema says, with every required key present: a missing
 * nullable is null, a missing array [], a missing boolean false, a missing
 * string ''. Never invents a value — only fills the shape.
 */
function fillFromSchema(value, schema) {
  if (!schema) return value;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (value === undefined || value === null) {
    if (types.includes('null') || schema.anyOf) return null;
    if (types.includes('array')) return [];
    if (types.includes('boolean')) return false;
    if (types.includes('string')) return '';
    if (types.includes('number') || types.includes('integer')) return null;
    if (types.includes('object')) value = {};
    else return null;
  }
  if (types.includes('array') && Array.isArray(value)) {
    return schema.items ? value.map((item) => fillFromSchema(item, schema.items)) : value;
  }
  if (types.includes('object') && value && typeof value === 'object' && schema.properties) {
    const out = {};
    for (const key of Object.keys(schema.properties)) out[key] = fillFromSchema(value[key], schema.properties[key]);
    return out;
  }
  return value;
}

function callCostUsd(model, usage) {
  const price = CLAUDE_PRICES.find(([name]) => String(model || '').startsWith(name))?.[1];
  if (!price || !usage) return null;
  const fresh = usage.input_tokens || 0;
  const read = usage.cache_read_input_tokens || 0;
  const write = usage.cache_creation_input_tokens || 0;
  return (fresh * price[0] + read * price[1] + write * price[2] + (usage.output_tokens || 0) * price[3]) / 1e6;
}

/**
 * One intake read on Claude. Same arguments as the OpenAI call; returns
 * { completion (OpenAI-shaped), parsed }. Throws on anything unusable.
 *
 * @param {Array} messages       OpenAI-shaped (system, [system draft], …, user)
 * @param {Object} responseFormat services/openai.js RESPONSE_FORMAT
 * @param {{model?: string, kind?: string}} [options]
 */
async function completeIntake(messages, responseFormat, { model = claudeModel(), kind = 'intake' } = {}) {
  if (!configured()) throw new Error('ANTHROPIC_API_KEY is not set');
  const schema = responseFormat?.json_schema?.schema;
  const systems = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const turns = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: claudeContent(m.content) }));

  const res = await getClient().messages.create({
    model,
    max_tokens: 16000,
    // The ~13k-token prompt + schema is identical on every call. One-hour
    // cache: intake traffic is a few messages an hour, so a 5-minute cache
    // would be written again for most of them.
    system: [
      {
        type: 'text',
        text: `${systems[0]}\n\nFORMAT DE SORTIE : réponds uniquement par un objet JSON valide conforme à ce JSON Schema (toutes les clés présentes, null quand l'information n'est pas donnée), sans texte autour ni bloc de code :\n${JSON.stringify(schemaForPrompt(schema))}`,
        cache_control: { type: 'ephemeral', ttl: '1h' },
      },
      ...systems.slice(1).map((text) => ({ type: 'text', text })),
    ],
    messages: turns,
    output_config: { effort: env('INTAKE_CLAUDE_EFFORT') || 'low' },
  });

  const usage = res.usage || {};
  const usd = callCostUsd(res.model || model, usage);
  console.log(
    `[ai-cost] ${kind} ${res.model || model} in=${(usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0)}`
    + ` cached=${usage.cache_read_input_tokens || 0} written=${usage.cache_creation_input_tokens || 0} out=${usage.output_tokens || 0}`
    + ` cost=${usd === null ? '?' : `${(usd * 100).toFixed(2)}c`}`,
  );

  if (res.stop_reason === 'refusal') throw new Error('Claude declined the request');
  if (res.stop_reason === 'max_tokens') throw new Error('Claude output was truncated');
  const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
    .trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`Claude returned non-JSON output: ${text.slice(0, 160)}`);
  }
  if (!raw || typeof raw !== 'object' || !raw.extracted_data || typeof raw.extracted_data !== 'object') {
    throw new Error('Claude returned JSON without extracted_data');
  }
  const parsed = fillFromSchema(raw, schema);
  if (typeof parsed.whatsapp_reply !== 'string' || !parsed.whatsapp_reply.trim()) {
    throw new Error('Claude returned no whatsapp_reply');
  }

  const completion = {
    model: res.model || model,
    provider: 'claude',
    usage: {
      prompt_tokens: (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
      prompt_tokens_details: { cached_tokens: usage.cache_read_input_tokens || 0 },
      completion_tokens: usage.output_tokens || 0,
      cache_write_tokens: usage.cache_creation_input_tokens || 0,
      usd,
    },
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(parsed), refusal: null } }],
  };
  return { completion, parsed };
}

/** The fields compared in the shadow trial — the ones a wrong value would publish. */
const SHADOW_FIELDS = [
  'is_listing', 'is_confirmed', 'is_correction', 'transaction_type', 'property_type', 'parcelle_subtype',
  'commune', 'quartier', 'price', 'negotiable_price', 'currency', 'price_period', 'deposit_months',
  'advance_months', 'commission_months', 'bedrooms', 'bathrooms', 'units_count', 'furnished',
  'is_multi_unit', 'is_multi_property', 'listing_status_update',
];

function fold(value) {
  if (typeof value === 'string') return value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return value === undefined ? null : value;
}

/**
 * The trial week: gpt-4o has already answered; Claude reads the same request
 * in the background and only the comparison is stored. Never throws, never
 * delays the agent's reply, sends nothing.
 *
 * @param {Array} messages
 * @param {Object} responseFormat
 * @param {Object} reference      gpt-4o's extracted_data, after the normalisers
 * @param {(extracted: Object) => Object} normalise  the same normalisers
 * @param {string} text           the agent's text (an excerpt is kept)
 */
function shadowCompare(messages, responseFormat, reference, normalise, text) {
  if (!shadowEnabled() || !configured()) return;
  const started = Date.now();
  completeIntake(messages, responseFormat, { kind: 'intake-shadow' })
    .then(({ completion, parsed }) => {
      const shadow = normalise(parsed.extracted_data);
      const diff = SHADOW_FIELDS.filter((f) => JSON.stringify(fold(reference?.[f])) !== JSON.stringify(fold(shadow?.[f])));
      const unitsRef = (reference?.units || []).length;
      const unitsShadow = (shadow?.units || []).length;
      if (unitsRef !== unitsShadow) diff.push('units.length');
      db.db.prepare(
        `INSERT INTO intake_shadow (created_at, model, text_excerpt, agree, diff_fields, reference, shadow, cost_usd, ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        new Date().toISOString(), completion.model, String(text || '').slice(0, 500), diff.length ? 0 : 1,
        JSON.stringify(diff), JSON.stringify(pick(reference)), JSON.stringify(pick(shadow)),
        completion.usage.usd, Date.now() - started,
      );
      console.log(`[intake-shadow] ${completion.model}: ${diff.length ? `differs on ${diff.join(', ')}` : 'same reading'}`);
    })
    .catch((err) => {
      try {
        db.db.prepare('INSERT INTO intake_shadow (created_at, model, text_excerpt, error, ms) VALUES (?, ?, ?, ?, ?)')
          .run(new Date().toISOString(), claudeModel(), String(text || '').slice(0, 500), String(err.message).slice(0, 300), Date.now() - started);
      } catch { /* a full disk must not reach the intake */ }
      console.warn(`[intake-shadow] Claude failed: ${err.message}`);
    });
}

function pick(extracted) {
  if (!extracted) return null;
  const out = Object.fromEntries(SHADOW_FIELDS.map((f) => [f, extracted[f] ?? null]));
  out.units = (extracted.units || []).length;
  out.reference = extracted.reference ?? null;
  return out;
}

module.exports = {
  DEFAULT_MODEL,
  provider,
  shadowEnabled,
  claudeModel,
  configured,
  completeIntake,
  shadowCompare,
  fillFromSchema,
  schemaForPrompt,
  callCostUsd,
  setClientForTests,
  SHADOW_FIELDS,
};
