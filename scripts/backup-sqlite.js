/**
 * Snapshot, list and restore-test the engine's SQLite database by hand.
 * The nightly run is the scheduler job `sqlite-backup` (services/sqliteBackup.js);
 * this is the same code for a one-off backup and for proving a backup restores.
 *
 *   node scripts/backup-sqlite.js                  # snapshot now + off-site copy + prune
 *   node scripts/backup-sqlite.js --local-only     # snapshot now, no upload
 *   node scripts/backup-sqlite.js --list           # local and off-site snapshots
 *   node scripts/backup-sqlite.js --restore-test [name|path]
 *        # newest off-site snapshot (or the one named, or a local .db.gz path):
 *        # gunzip into a temp file, integrity_check, and compare every table's
 *        # row count with the live database. Writes nothing outside the temp dir.
 *
 * Run from the engine dir so .env is loaded — DB_PATH there is /var/data/lukka_place.db.
 * This script never requires services/db.js: that module migrates the file it
 * opens, and a run without .env would migrate an empty lukka_place.db in the
 * engine dir instead of reading the real one.
 *
 * PUTTING A SNAPSHOT BACK (only if the live file is lost or corrupt):
 *   pm2 stop lukka-place-engine
 *   mv /var/data/lukka_place.db{,-wal,-shm} /var/data/broken-<date>/    # keep them
 *   gunzip -c /var/data/backups/lukka_place-<stamp>.db.gz > /var/data/lukka_place.db
 *   pm2 start lukka-place-engine
 * Everything written after <stamp> is gone; the engine's boot migrations bring
 * an older snapshot's schema up to date.
 */
require('dotenv').config({ quiet: true });

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const backup = require('../services/sqliteBackup');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'lukka_place.db');

function openLive() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`no database at ${DB_PATH} — run from the engine dir so .env sets DB_PATH`);
  return new Database(DB_PATH, { readonly: true, fileMustExist: true });
}

async function snapshot({ localOnly }) {
  const source = openLive();
  try {
    const result = await backup.runBackup({ source, dbPath: DB_PATH, remote: localOnly ? null : backup.supabaseRemote() });
    console.log(JSON.stringify({ dir: backup.backupDir(DB_PATH), ...result }, null, 2));
  } finally {
    source.close();
  }
}

async function list() {
  const dir = backup.backupDir(DB_PATH);
  const local = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => backup.dateFromName(n)).sort() : [];
  console.log(`Local (${dir}): ${local.length}`);
  for (const name of local) console.log(`  ${name}  ${fs.statSync(path.join(dir, name)).size} B`);
  const remote = (await backup.supabaseRemote().list()).filter((n) => backup.dateFromName(n));
  console.log(`Off-site (${backup.bucketName()}/sqlite): ${remote.length}`);
  for (const name of remote) console.log(`  ${name}`);
}

async function restoreTest(target) {
  let label;
  let buffer;
  if (target && fs.existsSync(target)) {
    label = path.resolve(target);
    buffer = fs.readFileSync(target);
  } else {
    const remote = backup.supabaseRemote();
    const names = (await remote.list()).filter((n) => backup.dateFromName(n)).sort();
    const name = target || names[names.length - 1];
    if (!name) throw new Error('no off-site snapshot to restore');
    label = `${remote.bucket}/sqlite/${name}`;
    buffer = await remote.download(name);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lukka-restore-'));
  const out = path.join(tmp, 'restored.db');
  try {
    const restored = await backup.restoreToFile(buffer, out);
    const live = backup.inspectDatabase(DB_PATH);
    console.log(`Restored : ${label} (${buffer.length} B gz)`);
    console.log(`integrity_check: ${restored.integrity}`);
    const tables = [...new Set([...Object.keys(live.counts), ...Object.keys(restored.counts)])].sort();
    let missing = 0;
    for (const t of tables) {
      const a = restored.counts[t];
      const b = live.counts[t];
      if (a === undefined) missing += 1;
      console.log(`  ${t.padEnd(36)} snapshot ${String(a ?? '—').padStart(7)}   live ${String(b ?? '—').padStart(7)}`);
    }
    if (restored.integrity !== 'ok') throw new Error('restored snapshot failed integrity_check');
    console.log(missing ? `\n${missing} live table(s) absent from the snapshot (created since it was taken).` : '\nEvery live table is present in the snapshot.');
    console.log('RESTORE TEST OK');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  if (args.includes('--list')) return list();
  if (args.includes('--restore-test')) return restoreTest(target);
  return snapshot({ localOnly: args.includes('--local-only') });
}

main().catch((err) => {
  console.error('backup-sqlite failed:', err.message);
  process.exit(1);
});
