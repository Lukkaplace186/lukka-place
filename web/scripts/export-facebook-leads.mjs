#!/usr/bin/env node
/**
 * Every Facebook group prospect still waiting for an invitation, as a CSV:
 * Phone, Author, Group, Post URL, Date Extracted.
 *
 *   npm run export:leads
 *   npm run export:leads -- --out=C:/tmp/prospects.csv
 *
 * Read-only: exporting does not mark anyone invited. Written to
 * exports/facebook-leads-<date>.csv by default (gitignored — it is a list of
 * people's phone numbers). UTF-8 with a BOM, comma-separated, like the
 * console's exports (lib/csv.js), so Excel shows accents correctly.
 *
 * Phone is +243XXXXXXXXX as text. Excel reads a cell like that as a number and
 * drops the "+"; tools that import contact lists read it as written.
 *
 * Requires DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME in .env.local, and the
 * engine's migrations/20261023_facebook_prospects.sql.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}

const PENDING_INVITES_SQL = `
  SELECT phone, author_name, group_name, post_url, created_at
    FROM facebook_prospects
   WHERE status = 'pending_invite'
   ORDER BY created_at, id`;

const kinshasaTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Africa/Kinshasa',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

// Same rules as lib/csv.js: a cell starting with = + - @ gets an apostrophe so
// it can never run as a formula. Phone is exempt: it is built from 12 digits
// we validated (CHECK on the column), and an apostrophe would break imports.
function cell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  const lines = ['Phone,Author,Group,Post URL,Date Extracted'];
  for (const r of rows) {
    if (!/^243\d{9}$/.test(r.phone)) continue;
    lines.push([
      `+${r.phone}`,
      cell(r.author_name),
      cell(r.group_name),
      cell(r.post_url),
      cell(kinshasaTime.format(r.created_at)),
    ].join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

const outArg = process.argv.find((a) => a.startsWith('--out='));
const today = new Date().toISOString().slice(0, 10);
const outPath = path.resolve(outArg ? outArg.slice(6) : `exports/facebook-leads-${today}.csv`);

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

try {
  const { rows } = await pool.query(PENDING_INVITES_SQL);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, toCsv(rows));
  console.log(`${rows.length} prospect(s) pending invite → ${outPath}`);
} catch (err) {
  if (err.code === '42P01') {
    console.error('facebook_prospects does not exist — run the engine migration 20261023_facebook_prospects.sql first.');
  } else {
    console.error(`Export failed: ${err.message}`);
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
