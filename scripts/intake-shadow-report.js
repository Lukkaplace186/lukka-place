#!/usr/bin/env node
/**
 * scripts/intake-shadow-report.js
 *
 * What a background trial found (INTAKE_SHADOW=claude | gpt-4.1,
 * services/claudeIntake.js): how often the trial model read live WhatsApp
 * listings the same way as gpt-4o, which fields differ, how often it failed,
 * what it cost. Read-only.
 *
 *   node scripts/intake-shadow-report.js [--days 7] [--examples 15] [--model gpt-4.1]
 *   --model: one trial's model (a name prefix); default: the latest trial's model.
 *   (on the VPS: node -r dotenv/config scripts/intake-shadow-report.js)
 */

require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const DAYS = Number(arg('days', 7));
const EXAMPLES = Number(arg('examples', 15));
const DB_FILE = process.env.DB_PATH || path.join(__dirname, '..', 'lukka_place.db');
const db = new Database(DB_FILE, { readonly: true, fileMustExist: true });

const since = new Date(Date.now() - DAYS * 86400000).toISOString();
let rows;
try {
  const latest = db.prepare('SELECT model FROM intake_shadow WHERE model IS NOT NULL ORDER BY id DESC LIMIT 1').get();
  const family = String(arg('model', latest ? String(latest.model).replace(/-\d{4}-\d{2}-\d{2}$/, '') : ''));
  rows = db.prepare('SELECT * FROM intake_shadow WHERE created_at >= ? AND model LIKE ? ORDER BY id').all(since, `${family}%`);
  console.log(`Model: ${family || 'all'}`);
} catch (err) {
  console.log(`No trial data yet (${err.message}).`);
  process.exit(0);
}

const done = rows.filter((r) => !r.error);
const failed = rows.filter((r) => r.error);
const same = done.filter((r) => r.agree === 1);
const fields = {};
for (const r of done) for (const f of JSON.parse(r.diff_fields || '[]')) fields[f] = (fields[f] || 0) + 1;
const cost = done.reduce((s, r) => s + (r.cost_usd || 0), 0);
const ms = done.reduce((s, r) => s + (r.ms || 0), 0);

console.log(`Trial, last ${DAYS} days — ${rows.length} messages read in the background`);
console.log(`  same reading as gpt-4o on every compared field: ${same.length}/${done.length}`
  + (done.length ? ` (${Math.round((same.length / done.length) * 100)}%)` : ''));
console.log(`  failed (gpt-4o would have taken over): ${failed.length}`);
if (done.length) {
  console.log(`  cost: $${cost.toFixed(2)} total, ${((cost / done.length) * 100).toFixed(2)} ¢ a message; avg ${Math.round(ms / done.length)} ms`);
}
console.log('  fields that differ:', Object.entries(fields).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(', ') || 'none');

const differing = done.filter((r) => r.agree === 0).slice(-EXAMPLES);
if (differing.length) console.log(`\nLast ${differing.length} differences (gpt-4o → trial model):`);
for (const r of differing) {
  const ref = JSON.parse(r.reference || '{}');
  const sh = JSON.parse(r.shadow || '{}');
  console.log(`\n#${r.id} ${r.created_at.slice(0, 16)} — ${String(r.text_excerpt || '').replace(/\s+/g, ' ').slice(0, 140)}`);
  for (const f of JSON.parse(r.diff_fields || '[]')) {
    const key = f === 'units.length' ? 'units' : f;
    console.log(`    ${f}: ${JSON.stringify(ref[key])} → ${JSON.stringify(sh[key])}`);
  }
}
if (failed.length) {
  console.log('\nFailures:');
  for (const r of failed.slice(-5)) console.log(`  ${r.created_at.slice(0, 16)} ${r.error}`);
}
