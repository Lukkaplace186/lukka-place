#!/usr/bin/env node
/**
 * scripts/eval-intake-models.js
 *
 * Runs the same text-only intake messages through two models and compares the
 * fields that matter, so a model change for services/openai.js's intake is
 * measured, not assumed (2026-11-03: gpt-4o-mini was measured and refused).
 *
 * Corpus: every listing's stored `raw_text` in a SQLite file (read-only, never
 * migrated — services/db.js is not loaded), plus built-in hard cases: draft
 * corrections, a multi-property paste, Lingala, commercial, short-term, and
 * messages that are not listings.
 *
 *   node scripts/eval-intake-models.js [--db <file>] [--limit 40]
 *        [--a gpt-4o] [--b gpt-4o-mini]
 *
 * Costs real API calls: one per message per model. gpt-4o is ~3 US cents per
 * message (the system prompt and schema are ~13k tokens), gpt-4o-mini ~0.2.
 * Prints each disagreement, then a per-field tally.
 */

require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');
const { parseMessage, draftContextFromListing } = require('../services/openai');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const DB_FILE = arg('db', process.env.DB_PATH || path.join(__dirname, '..', 'lukka_place.db'));
const LIMIT = Number(arg('limit', 40));
const MODEL_A = arg('a', 'gpt-4o');
const MODEL_B = arg('b', 'gpt-4o-mini');

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
  console.log(`[eval] ${cases.length} messages, ${MODEL_A} vs ${MODEL_B}\n`);
  const tally = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  const usage = { [MODEL_A]: { in: 0, cached: 0, out: 0 }, [MODEL_B]: { in: 0, cached: 0, out: 0 } };
  let agreeAll = 0;

  for (const c of cases) {
    let a;
    let b;
    try {
      [a, b] = await Promise.all([run(MODEL_A, c), run(MODEL_B, c)]);
    } catch (err) {
      console.log(`✗ ${c.name}: ${err.message}`);
      continue;
    }
    for (const [m, r] of [[MODEL_A, a], [MODEL_B, b]]) {
      const u = r._meta.usage || {};
      usage[m].in += u.prompt_tokens || 0;
      usage[m].cached += u.prompt_tokens_details?.cached_tokens || 0;
      usage[m].out += u.completion_tokens || 0;
    }
    const diffs = FIELDS.filter((f) => JSON.stringify(norm(a.extracted_data[f])) !== JSON.stringify(norm(b.extracted_data[f])));
    const unitsA = (a.extracted_data.units || []).length;
    const unitsB = (b.extracted_data.units || []).length;
    if (unitsA !== unitsB) diffs.push('units.length');
    diffs.forEach((f) => { tally[f] = (tally[f] || 0) + 1; });
    if (!diffs.length) agreeAll += 1;

    console.log(`${diffs.length ? '≠' : '='} ${c.name}${b._meta.escalatedFrom ? ' (B escalated)' : ''}`);
    for (const f of diffs) {
      const va = f === 'units.length' ? unitsA : a.extracted_data[f];
      const vb = f === 'units.length' ? unitsB : b.extracted_data[f];
      console.log(`    ${f}: ${JSON.stringify(va)}  vs  ${JSON.stringify(vb)}`);
    }
    if (diffs.length || c.draft || !a.extracted_data.is_listing) {
      console.log(`    A reply: ${String(a.whatsapp_reply).replace(/\s+/g, ' ').slice(0, 160)}`);
      console.log(`    B reply: ${String(b.whatsapp_reply).replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }

  console.log(`\n[eval] identical on every field: ${agreeAll}/${cases.length}`);
  console.log('[eval] disagreements per field:', Object.fromEntries(Object.entries(tally).filter(([, n]) => n)));
  console.log('[eval] tokens:', usage);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
