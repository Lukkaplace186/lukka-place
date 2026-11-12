#!/usr/bin/env node
/**
 * scripts/eval-intake-models.js
 *
 * Runs the same text-only intake messages through several models and compares the
 * fields that matter, so a model change for services/openai.js's intake is
 * measured, not assumed (2026-11-03: gpt-4o-mini was measured and refused).
 *
 * Corpus: every listing's stored `raw_text` in a SQLite file (read-only, never
 * migrated — services/db.js is not loaded), plus built-in hard cases: draft
 * corrections, a multi-property paste, Lingala, commercial, short-term, and
 * messages that are not listings.
 *
 *   node scripts/eval-intake-models.js [--db <file>] [--limit 40] [--cases <file.json>]
 *        [--models gpt-4o,claude-haiku-5-5,claude-sonnet-5-5] [--effort low]
 *        (or the older [--a gpt-4o] [--b gpt-4o-mini])
 *
 * The first model is the reference; every other one is compared with it.
 * --cases: a JSON array of {name, text} used instead of the SQLite corpus
 * (e.g. a sample copied from production, kept outside the repo).
 *
 * Claude models (2026-11-11): a "claude-*" name is sent to the Anthropic API
 * (ANTHROPIC_API_KEY) with the SAME system prompt, schema and post-processing
 * — the OpenAI-shaped request is translated, so services/openai.js is not
 * touched. --effort sets Claude's output_config.effort (default low).
 *
 * Costs real API calls: one per message per model. gpt-4o is ~3 US cents per
 * message (the system prompt and schema are ~13k tokens), gpt-4o-mini ~0.2.
 * Prints each disagreement, then a per-field tally and each model's measured cost.
 */

require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');
const openaiService = require('../services/openai');

const { parseMessage } = openaiService;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const DB_FILE = arg('db', process.env.DB_PATH || path.join(__dirname, '..', 'lukka_place.db'));
const LIMIT = Number(arg('limit', 40));
const MODELS = arg('models', null)
  ? arg('models').split(',').map((m) => m.trim()).filter(Boolean)
  : [arg('a', 'gpt-4o'), arg('b', 'gpt-4o-mini')];
const CASES_FILE = arg('cases', null);
const EFFORT = arg('effort', 'low');

// ---------------------------------------------------------------------------
// Claude: the OpenAI-shaped intake request, translated.
// ---------------------------------------------------------------------------

/** US$ per million tokens: [input, cache read, cache write (5 min), output]. Anthropic list prices, 2026-11-03. */
const CLAUDE_PRICES = [
  ['claude-haiku-5-5', [0.10, 0.01, 0.125, 0.50]],
  ['claude-sonnet-5-5', [2, 0.10, 2.5, 10]],
  ['claude-opus-5-5', [4, 0.20, 5, 20]],
];

let anthropic;
function claudeClient() {
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is missing — set it in .env to test Claude models');
    // eslint-disable-next-line global-require
    const Anthropic = require('@anthropic-ai/sdk').default;
    anthropic = new Anthropic();
  }
  return anthropic;
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
 * OpenAI's strict schema writes a nullable enum as {type: ['string', 'null'],
 * enum: ['a', null]}; Anthropic refuses an enum value that does not match a
 * single declared type. Same meaning, written as anyOf.
 */
function claudeSchema(node) {
  if (Array.isArray(node)) return node.map(claudeSchema);
  if (!node || typeof node !== 'object') return node;
  const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, claudeSchema(v)]));
  if (Array.isArray(out.type) && out.type.includes('null') && Array.isArray(out.enum)) {
    const { type, enum: values, ...rest } = out;
    const types = type.filter((t) => t !== 'null');
    return {
      ...rest,
      anyOf: [
        { type: types.length === 1 ? types[0] : types, enum: values.filter((v) => v !== null) },
        { type: 'null' },
      ],
    };
  }
  return out;
}

async function claudeCreate(params) {
  const systems = params.messages.filter((m) => m.role === 'system').map((m) => m.content);
  const messages = params.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: claudeContent(m.content) }));
  // Anthropic's constrained decoding allows 16 nullable/union fields; the
  // intake schema has 48, so it is refused (400). The schema goes into the
  // (cached) prompt instead and the answer must be bare JSON; one that does
  // not parse counts as a failure for that model.
  const schemaText = JSON.stringify(claudeSchema(params.response_format.json_schema.schema));
  const res = await claudeClient().messages.create({
    model: params.model,
    max_tokens: 16000,
    // The ~13k-token prompt is identical on every call: cached like OpenAI's.
    system: [
      {
        type: 'text',
        text: `${systems[0]}\n\nFORMAT DE SORTIE : réponds uniquement par un objet JSON valide conforme à ce JSON Schema (toutes les clés présentes, null quand l'information n'est pas donnée), sans texte autour ni bloc de code :\n${schemaText}`,
        cache_control: { type: 'ephemeral' },
      },
      ...systems.slice(1).map((text) => ({ type: 'text', text })),
    ],
    messages,
    output_config: { effort: EFFORT },
  });
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    .trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const u = res.usage || {};
  return {
    model: res.model,
    usage: {
      prompt_tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
      prompt_tokens_details: { cached_tokens: u.cache_read_input_tokens || 0 },
      completion_tokens: u.output_tokens || 0,
      cache_write_tokens: u.cache_creation_input_tokens || 0,
    },
    choices: [{
      finish_reason: res.stop_reason === 'max_tokens' ? 'length' : 'stop',
      message: {
        content: text,
        refusal: res.stop_reason === 'refusal' ? (res.stop_details?.explanation || 'refused') : null,
      },
    }],
  };
}

// Route claude-* through the translation; everything else is the real OpenAI call.
if (MODELS.some((m) => m.startsWith('claude-'))) {
  const completions = openaiService.getClient().chat.completions;
  const original = completions.create.bind(completions);
  completions.create = (params, opts) => (String(params.model).startsWith('claude-') ? claudeCreate(params) : original(params, opts));
}

/** Measured cost of one call, in US$ (null for a model with no price here). */
function costOf(model, usage) {
  const claude = CLAUDE_PRICES.find(([name]) => String(model).startsWith(name))?.[1];
  if (!claude) return openaiService.callCost(model, usage).usd;
  const cached = usage.prompt_tokens_details?.cached_tokens || 0;
  const write = usage.cache_write_tokens || 0;
  const fresh = usage.prompt_tokens - cached - write;
  return (fresh * claude[0] + cached * claude[1] + write * claude[2] + usage.completion_tokens * claude[3]) / 1e6;
}

const FIELDS = [
  'is_listing', 'is_confirmed', 'is_correction', 'intent', 'transaction_type', 'property_type',
  'parcelle_subtype', 'city', 'commune', 'quartier', 'price', 'currency', 'price_period',
  'deposit_months', 'advance_months', 'commission_months', 'bedrooms', 'bathrooms',
  'units_count', 'furnished', 'office_count', 'reference', 'is_multi_unit', 'is_multi_property',
  'listing_status_update',
];

const DRAFT = {
  transaction_type: 'location', property_type: 'appartement', commune: 'Kintambo',
  quartier: 'Jamaïque', price: 600, currency: 'USD', price_period: 'mois',
  deposit_months: 3, advance_months: 1, commission_months: 1, bedrooms: 2, bathrooms: 1,
  photos_count: 3, statut: 'brouillon',
};
const DRAFT_HISTORY = [{ role: 'user', content: 'Appartement 2 chambres à louer Kintambo Jamaïque 600$ garantie 3+1+1' }];

const HARD_CASES = [
  { name: 'correction: garantie', text: 'pas 3+1+1 mais 2+1+1', draft: DRAFT },
  { name: 'correction: bare price', text: 'non 1100$', draft: DRAFT },
  { name: 'correction: no commission', text: 'pas de commission', draft: DRAFT },
  { name: 'correction: bare non', text: 'non', draft: DRAFT },
  { name: 'correction: commune', text: "c'est à Ngaliema, pas Kintambo", draft: DRAFT },
  { name: 'confirmation', text: 'ok merci', draft: DRAFT },
  { name: 'buyer request', text: 'Bonjour je cherche un appartement 2 chambres à Gombe, budget 800$' },
  { name: 'signup question', text: "comment se passe l'inscription ? c'est gratuit ?" },
  { name: 'lingala mix', text: 'Ndako ya kofutela na Lemba Righini, 3 chambres, salon, 2 douches, 400$ na sanza, garantie 3+1+1' },
  { name: 'parcelle type locataire', text: 'A vendre parcelle 15/20 à Masina Sans-Fil, maison type locataire 4 portes, titre foncier, 45 000$ à discuter' },
  { name: 'commercial', text: 'Bureau à louer Gombe boulevard du 30 juin, 5 bureaux, 2 toilettes, parking, 2500$/mois, garantie 6 mois' },
  { name: 'short term', text: 'Studio meublé à Gombe, wifi, climatisé, 50$ la nuitée' },
  {
    name: 'multi-property paste',
    text: '1) Appartement 3 chambres Limete 7ème rue, 900$/mois, 3+1+1\n'
      + '2) Maison 4 chambres à vendre Ngaliema Binza Pigeon, 180 000$\n'
      + '3) Studio Bandal Moulaert 250$/mois garantie 4+1',
  },
  { name: 'status update', text: "Le bien de Kintambo c'est déjà loué" , draft: { ...DRAFT, statut: 'publiée' } },
];

function corpus() {
  if (CASES_FILE) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return [...require(path.resolve(CASES_FILE)), ...HARD_CASES];
  }
  let rows = [];
  try {
    const db = new Database(DB_FILE, { readonly: true, fileMustExist: true });
    rows = db.prepare(
      `SELECT id, raw_text FROM listings
        WHERE raw_text IS NOT NULL AND length(trim(raw_text)) > 20
        ORDER BY id DESC LIMIT ?`,
    ).all(LIMIT);
    db.close();
  } catch (err) {
    console.warn(`[eval] no listings read from ${DB_FILE}: ${err.message}`);
  }
  return [
    // raw_text accumulates one line per correction turn; the first line(s)
    // are what arrived, so the whole text is a fair first-contact message.
    ...rows.map((r) => ({ name: `listing #${r.id}`, text: r.raw_text })),
    ...HARD_CASES,
  ];
}

function norm(v) {
  if (typeof v === 'string') return v.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return v === undefined ? null : v;
}

async function run(model, c) {
  const options = { model };
  if (c.draft) Object.assign(options, { draft: c.draft, history: DRAFT_HISTORY });
  const t0 = Date.now();
  const res = await parseMessage(c.text, options);
  return { ...res, ms: Date.now() - t0 };
}

(async () => {
  const cases = corpus();
  const [REF, ...OTHERS] = MODELS;
  const effortNote = MODELS.some((m) => m.startsWith('claude-')) ? ` (Claude effort ${EFFORT})` : '';
  console.log(`[eval] ${cases.length} messages, reference ${REF} vs ${OTHERS.join(', ')}${effortNote}\n`);
  const tally = Object.fromEntries(OTHERS.map((m) => [m, {}]));
  const agreeAll = Object.fromEntries(OTHERS.map((m) => [m, 0]));
  const stats = Object.fromEntries(MODELS.map((m) => [m, {
    calls: 0, failed: 0, in: 0, cached: 0, write: 0, out: 0, usd: 0, ms: 0,
  }]));

  for (const c of cases) {
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(MODELS.map((m) => run(m, c).catch((err) => ({ error: err.message }))));
    const byModel = Object.fromEntries(MODELS.map((m, i) => [m, results[i]]));
    for (const m of MODELS) {
      const r = byModel[m];
      if (r.error) {
        stats[m].failed += 1;
      } else {
        const u = r._meta.usage || {};
        stats[m].calls += 1;
        stats[m].in += u.prompt_tokens || 0;
        stats[m].cached += u.prompt_tokens_details?.cached_tokens || 0;
        stats[m].write += u.cache_write_tokens || 0;
        stats[m].out += u.completion_tokens || 0;
        stats[m].usd += costOf(r._meta.model || m, u) || 0;
        stats[m].ms += r.ms;
      }
    }
    const ref = byModel[REF];
    if (ref.error) {
      console.log(`✗ ${c.name}: ${REF} failed: ${ref.error}`);
      continue;
    }

    const lines = [];
    let anyDiff = false;
    for (const m of OTHERS) {
      const r = byModel[m];
      if (r.error) {
        lines.push(`    ${m} FAILED: ${r.error.slice(0, 300)}`);
        anyDiff = true;
        continue;
      }
      const diffs = FIELDS.filter((f) => JSON.stringify(norm(ref.extracted_data[f])) !== JSON.stringify(norm(r.extracted_data[f])));
      const unitsRef = (ref.extracted_data.units || []).length;
      const units = (r.extracted_data.units || []).length;
      if (unitsRef !== units) diffs.push('units.length');
      diffs.forEach((f) => { tally[m][f] = (tally[m][f] || 0) + 1; });
      if (!diffs.length) agreeAll[m] += 1; else anyDiff = true;
      for (const f of diffs) {
        const vRef = f === 'units.length' ? unitsRef : ref.extracted_data[f];
        const v = f === 'units.length' ? units : r.extracted_data[f];
        lines.push(`    [${m}] ${f}: ${JSON.stringify(vRef)}  vs  ${JSON.stringify(v)}`);
      }
    }
    console.log(`${anyDiff ? '≠' : '='} ${c.name}`);
    lines.forEach((l) => console.log(l));
    if (anyDiff || c.draft || !ref.extracted_data.is_listing) {
      for (const m of MODELS) {
        const r = byModel[m];
        if (!r.error) console.log(`    ${m} reply: ${String(r.whatsapp_reply).replace(/\s+/g, ' ').slice(0, 160)}`);
      }
    }
  }

  console.log('');
  for (const m of OTHERS) {
    console.log(`[eval] ${m}: identical to ${REF} on every field: ${agreeAll[m]}/${cases.length}`);
    console.log(`[eval] ${m}: disagreements per field:`, tally[m]);
  }
  console.log('\n[eval] measured cost and speed per message:');
  for (const m of MODELS) {
    const st = stats[m];
    const n = st.calls || 1;
    const per = st.calls ? st.usd / st.calls : 0;
    console.log(`  ${m.padEnd(20)} calls=${st.calls} failed=${st.failed} avg in=${Math.round(st.in / n)} `
      + `(cached ${Math.round(st.cached / n)}, written ${Math.round(st.write / n)}) out=${Math.round(st.out / n)}  `
      + `${(per * 100).toFixed(3)} c/msg  ~ $${(per * 1000 * 30).toFixed(0)}/month at 1,000/day  avg ${Math.round(st.ms / n)} ms`);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
