#!/usr/bin/env node
'use strict';

/**
 * Puts a contact list (CSV "Phone Number,Customer Name", the format of the
 * invite exports, e.g. Launch_Booklet.csv) on the ONE agent-prospect list,
 * market_prospects (/admin/market-data/prospects). Owner request 2026-11-13:
 * one list, still showing who already has an account — the list's "déjà
 * agent" badge is computed live from `agents`, so these rows get it too.
 *
 *   node scripts/import-prospects-csv.js <file.csv> [--source launch_booklet] [--skip 243…,243…] [--write]
 *
 * Dry run by default. Same upsert as the advert imports
 * (services/marketProspects.js): a number already on the list keeps its
 * name, agency, status and notes; only a blank name is filled and the source
 * added. No advert is counted. A DRC number must read 243 + 9 digits starting
 * 8 or 9; anything else (a '+' alone, +242…, +248…, 2430…) is skipped and
 * listed, never corrected by guess.
 */

require('dotenv').config({ quiet: true });
const fs = require('fs');
const prospects = require('../services/marketProspects');

/** One CSV line → [phone, name]; a quoted name may hold commas. */
function splitLine(line) {
  const comma = line.indexOf(',');
  if (comma < 0) return [line.trim(), ''];
  let name = line.slice(comma + 1).trim();
  if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1).replace(/""/g, '"');
  return [line.slice(0, comma).trim(), name];
}

/**
 * `{ entries: [{phone, name, names}], skipped: [{line, written, name, why}] }` —
 * one entry per number, the first name kept and the others listed.
 */
function readContacts(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const byPhone = new Map();
  const skipped = [];
  lines.forEach((line, i) => {
    if (!line.trim() || (i === 0 && /phone/i.test(line))) return;
    const [written, rawName] = splitLine(line);
    const name = rawName.replace(/\s+/g, ' ').trim() || null;
    const phone = prospects.prospectPhone(written);
    let why = null;
    if (!phone) why = 'not a phone number';
    else if (phone.startsWith('243') && !/^243[89]\d{8}$/.test(phone)) why = 'not a DRC mobile (243 + 9 digits from 8 or 9)';
    else if (!phone.startsWith('243')) why = `not a DRC number (+${phone.slice(0, 3)}…)`;
    if (why) { skipped.push({ line: i + 1, written, name, why }); return; }
    const entry = byPhone.get(phone) || { phone, name: null, names: [] };
    if (name && !entry.names.includes(name)) entry.names.push(name);
    entry.name = entry.name || (name ? name.slice(0, 120) : null);
    byPhone.set(phone, entry);
  });
  return { entries: [...byPhone.values()], skipped };
}

const STATE_SQL = `
  SELECT n.phone,
         (SELECT mp.name FROM market_prospects mp WHERE mp.phone = n.phone) AS listed_name,
         EXISTS (SELECT 1 FROM market_prospects mp WHERE mp.phone = n.phone) AS listed,
         EXISTS (SELECT 1 FROM agents a
                  WHERE regexp_replace(COALESCE(a.phone, ''), '\\D', '', 'g') = n.phone
                    AND (to_jsonb(a) ->> 'deleted_at') IS NULL) AS is_agent
    FROM unnest($1::text[]) AS n(phone)`;

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) throw new Error('usage: node scripts/import-prospects-csv.js <file.csv> [--source name] [--write]');
  const write = args.includes('--write');
  const sourceAt = args.indexOf('--source');
  const source = sourceAt >= 0 ? args[sourceAt + 1] : 'launch_booklet';
  if (!/^[a-z0-9_]{2,40}$/.test(source || '')) throw new Error(`bad --source '${source}'`);

  // --skip 243820314747,243… leaves those numbers out (owner's request:
  // Heaven Agence Immo stays off the invite list, 2026-11-03).
  const skipAt = args.indexOf('--skip');
  const leaveOut = new Set(skipAt >= 0 ? String(args[skipAt + 1] || '').split(',').map((p) => prospects.prospectPhone(p)).filter(Boolean) : []);
  const read = readContacts(fs.readFileSync(file, 'utf8'));
  const entries = read.entries.filter((e) => !leaveOut.has(e.phone));
  const { skipped } = read;
  for (const e of read.entries.filter((x) => leaveOut.has(x.phone))) skipped.push({ line: '-', written: `+${e.phone}`, name: e.name, why: 'left out (--skip)' });
  // eslint-disable-next-line global-require
  const postgres = require('../services/postgres');
  const client = await postgres.getPool().connect();
  try {
    await client.query(write ? 'BEGIN' : 'BEGIN READ ONLY');
    const { rows } = await client.query(STATE_SQL, [entries.map((e) => e.phone)]);
    const state = new Map(rows.map((r) => [r.phone, r]));
    const listed = entries.filter((e) => state.get(e.phone)?.listed);
    const agents = entries.filter((e) => state.get(e.phone)?.is_agent);
    console.log(`MODE: ${write ? 'WRITE' : 'DRY RUN — nothing stored, re-run with --write'} (source '${source}')`);
    console.log(`${entries.length} number(s): ${entries.length - listed.length} new to the list, ${listed.length} already on it; ${agents.length} already have a Lukka Place account`);
    const multi = entries.filter((e) => e.names.length > 1);
    if (multi.length) {
      console.log(`${multi.length} number(s) written under several names (first one kept):`);
      for (const e of multi) console.log(`  +${e.phone}: ${e.names.join(' / ')}`);
    }
    if (skipped.length) {
      console.log(`${skipped.length} line(s) skipped:`);
      for (const s of skipped) console.log(`  line ${s.line}: '${s.written}' ${s.name || ''} — ${s.why}`);
    }
    if (agents.length) {
      console.log('Already Lukka Place agents:');
      for (const e of agents) console.log(`  +${e.phone} ${e.name || ''}`);
    }
    if (write) {
      let created = 0;
      for (const e of entries) {
        // eslint-disable-next-line no-await-in-loop
        const res = await client.query(prospects.UPSERT_PROSPECT_SQL, [e.phone, e.name, null, [source], null, 0, null]);
        if (res.rows[0].created) created += 1;
      }
      await client.query('COMMIT');
      console.log(`stored: ${created} new, ${entries.length - created} updated`);
    } else {
      await client.query('COMMIT');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await postgres.getPool().end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { readContacts, splitLine };
