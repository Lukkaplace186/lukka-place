/**
 * services/sqliteBackup.js
 *
 * Nightly snapshot of the engine's SQLite database, kept on the VPS and copied
 * off it.
 *
 * WHY IT EXISTS
 * /var/data/lukka_place.db holds things that live nowhere else: leads,
 * viewing_requests, conversations and their transcripts, the pending
 * agent/customer questions, job_runs, onboarding state. Until 2026-10-15 it had
 * no backup at all — no crontab, nothing in the repo — so a disk failure or a
 * bad `rm` on the VPS lost every customer request ever made.
 *
 * WHY THE BACKUP API AND NOT cp
 * The database runs in WAL mode: recent commits sit in lukka_place.db-wal
 * until a checkpoint folds them into the main file. Copying the .db alone
 * silently drops them (on 2026-10-15 the WAL was 3.3 MB beside a 0.5 MB main
 * file), and copying the two files one after the other can catch a checkpoint
 * half-way. better-sqlite3's `db.backup()` is SQLite's online backup API: it
 * produces one self-contained, transactionally consistent file while the
 * engine keeps writing.
 *
 * WHAT A RUN DOES
 *   1. backup() into <BACKUP_DIR>/lukka_place-<UTC stamp>.db.partial
 *   2. opens that copy read-only and runs PRAGMA integrity_check — a snapshot
 *      that fails it is deleted and the run fails, never uploaded
 *   3. gzips it to .db.gz (the raw copy is removed) and renames into place, so
 *      a half-written file never carries the final name
 *   4. uploads it to a PRIVATE Supabase Storage bucket (SQLITE_BACKUP_BUCKET,
 *      default `engine-backups`), creating the bucket private if missing and
 *      refusing to upload into a bucket that is public
 *   5. prunes snapshots older than SQLITE_BACKUP_KEEP_DAYS (14) — locally, and
 *      off-site only after this run's upload succeeded, so a broken upload can
 *      never leave us with fewer copies than before
 *
 * A failed upload fails the job (job_runs.last_error), which the
 * ops-health-alerts job already reports as "a job whose last run failed". The
 * local snapshot is kept either way.
 *
 * Restore: scripts/backup-sqlite.js --restore-test proves a snapshot opens;
 * the deploy note in that script says how to put one back.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const Database = require('better-sqlite3');

const FILE_PREFIX = 'lukka_place-';
const FILE_SUFFIX = '.db.gz';
const REMOTE_PREFIX = 'sqlite';
const DAY_MS = 24 * 60 * 60 * 1000;

function keepDays() {
  const n = Number.parseInt(process.env.SQLITE_BACKUP_KEEP_DAYS, 10);
  return Number.isFinite(n) && n >= 1 ? n : 14;
}

function bucketName() {
  return process.env.SQLITE_BACKUP_BUCKET || 'engine-backups';
}

function backupDir(dbPath) {
  return process.env.SQLITE_BACKUP_DIR || path.join(path.dirname(path.resolve(dbPath)), 'backups');
}

/** 2026-10-15T02:00:07.123Z -> 20261015T020007Z (sorts lexically = chronologically). */
function stampFor(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function snapshotName(date) {
  return `${FILE_PREFIX}${stampFor(date)}${FILE_SUFFIX}`;
}

/** The instant encoded in a snapshot's name, or null for anything else. */
function dateFromName(name) {
  const m = /^lukka_place-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.db\.gz$/.exec(path.basename(String(name)));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

/** Names whose stamp is older than the retention window. Unrecognised names are never touched. */
function expiredNames(names, now = new Date(), days = keepDays()) {
  const cutoff = now.getTime() - days * DAY_MS;
  return names.filter((name) => {
    const at = dateFromName(name);
    return at && at.getTime() < cutoff;
  });
}

/** Opens a file read-only and returns integrity_check's verdict plus per-table row counts. */
function inspectDatabase(file) {
  const copy = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = copy.pragma('integrity_check', { simple: true });
    const tables = copy
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);
    const counts = {};
    for (const name of tables) {
      counts[name] = copy.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get().n;
    }
    return { integrity, counts };
  } finally {
    copy.close();
  }
}

/**
 * Takes one consistent snapshot of `source` (an open better-sqlite3 handle)
 * into `dir`. Returns { file, name, bytes, counts }.
 */
async function takeSnapshot({ source, dir, now = new Date() }) {
  fs.mkdirSync(dir, { recursive: true });
  const name = snapshotName(now);
  const raw = path.join(dir, `${name.slice(0, -'.gz'.length)}.partial`);
  const gzPartial = path.join(dir, `${name}.partial`);
  const finalPath = path.join(dir, name);

  try {
    await source.backup(raw);
    // The copy inherits the source's WAL flag; a snapshot should be one
    // self-contained file that never grows -wal/-shm sidecars when opened.
    const copy = new Database(raw, { fileMustExist: true });
    try {
      copy.pragma('journal_mode = DELETE');
    } finally {
      copy.close();
    }
    const { integrity, counts } = inspectDatabase(raw);
    if (integrity !== 'ok') throw new Error(`integrity_check on the snapshot returned: ${String(integrity).slice(0, 200)}`);

    await pipeline(fs.createReadStream(raw), zlib.createGzip({ level: 9 }), fs.createWriteStream(gzPartial));
    fs.renameSync(gzPartial, finalPath);
    return { file: finalPath, name, bytes: fs.statSync(finalPath).size, counts };
  } finally {
    fs.rmSync(raw, { force: true });
    fs.rmSync(gzPartial, { force: true });
  }
}

function pruneLocal(dir, now = new Date(), days = keepDays()) {
  if (!fs.existsSync(dir)) return [];
  const doomed = expiredNames(fs.readdirSync(dir), now, days);
  for (const name of doomed) fs.rmSync(path.join(dir, name), { force: true });
  return doomed;
}

/**
 * The Supabase Storage side, as a tiny interface so verify-pipeline can hand
 * in a fake: { ensurePrivateBucket(), upload(remotePath, buffer), list(), remove(paths) }.
 */
function supabaseRemote({ client, bucket = bucketName() } = {}) {
  let resolvedClient = client;
  const getClient = () => {
    if (!resolvedClient) {
      // eslint-disable-next-line global-require
      const supabaseStorage = require('./supabaseStorage');
      if (!supabaseStorage.isConfigured()) {
        throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — no off-site copy possible');
      }
      resolvedClient = supabaseStorage.getClient();
    }
    return resolvedClient;
  };

  return {
    bucket,
    async ensurePrivateBucket() {
      const storage = getClient().storage;
      const { data, error } = await storage.getBucket(bucket);
      if (data) {
        // The database holds customers' phone numbers and transcripts. A
        // public bucket would publish every snapshot at a guessable URL.
        if (data.public) throw new Error(`bucket '${bucket}' is PUBLIC — refusing to upload a database snapshot into it`);
        return;
      }
      const created = await storage.createBucket(bucket, { public: false });
      if (created.error && !/already exists/i.test(created.error.message)) {
        throw new Error(`could not create private bucket '${bucket}': ${created.error.message} (getBucket said: ${error?.message})`);
      }
    },
    async upload(name, buffer) {
      const { error } = await getClient()
        .storage.from(bucket)
        .upload(`${REMOTE_PREFIX}/${name}`, buffer, { contentType: 'application/gzip', upsert: false });
      if (error) throw new Error(`upload of ${name} failed: ${error.message}`);
    },
    async list() {
      const { data, error } = await getClient()
        .storage.from(bucket)
        .list(REMOTE_PREFIX, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw new Error(`listing '${bucket}/${REMOTE_PREFIX}' failed: ${error.message}`);
      return (data || []).map((entry) => entry.name);
    },
    async download(name) {
      const { data, error } = await getClient().storage.from(bucket).download(`${REMOTE_PREFIX}/${name}`);
      if (error) throw new Error(`download of ${name} failed: ${error.message}`);
      return Buffer.from(await data.arrayBuffer());
    },
    async remove(names) {
      if (!names.length) return;
      const { error } = await getClient()
        .storage.from(bucket)
        .remove(names.map((name) => `${REMOTE_PREFIX}/${name}`));
      if (error) throw new Error(`removing old snapshots failed: ${error.message}`);
    },
  };
}

/**
 * One full run: snapshot, prune local, upload, prune remote.
 * `remote: null` skips the off-site half (scripts/backup-sqlite.js --local-only).
 */
async function runBackup({ source, dbPath, remote = supabaseRemote(), now = new Date(), dir = backupDir(dbPath) } = {}) {
  const snap = await takeSnapshot({ source, dir, now });
  const prunedLocal = pruneLocal(dir, now);
  const result = {
    name: snap.name,
    bytes: snap.bytes,
    leads: snap.counts.leads ?? null,
    viewing_requests: snap.counts.viewing_requests ?? null,
    prunedLocal: prunedLocal.length,
    uploaded: false,
    prunedRemote: 0,
  };
  if (!remote) return result;

  await remote.ensurePrivateBucket();
  await remote.upload(snap.name, fs.readFileSync(snap.file));
  result.uploaded = true;
  result.bucket = remote.bucket;

  const doomed = expiredNames(await remote.list(), now);
  await remote.remove(doomed);
  result.prunedRemote = doomed.length;
  return result;
}

/** Gunzips a snapshot to `outFile` and inspects it — the restore test. */
async function restoreToFile(gzBuffer, outFile) {
  fs.writeFileSync(outFile, zlib.gunzipSync(gzBuffer));
  return inspectDatabase(outFile);
}

// ---------------------------------------------------------------------------
// Scheduler job
// ---------------------------------------------------------------------------

const JOB_NAME = 'sqlite-backup';
const CONFIGURED_HOUR = Number.parseInt(process.env.SQLITE_BACKUP_HOUR, 10);
/** Kinshasa hour (UTC+1). 3h: after the day's traffic, before the 6h commission run. */
const BACKUP_HOUR_KINSHASA = Number.isFinite(CONFIGURED_HOUR) ? CONFIGURED_HOUR : 3;
const MIN_GAP_MS = 20 * 60 * 60 * 1000;
/** A night missed (engine down at 3h) is caught up at the next tick after this. */
const CATCH_UP_MS = 26 * 60 * 60 * 1000;
/** After a failure, wait this long before the next attempt rather than retrying every minute. */
const RETRY_AFTER_MS = 15 * 60 * 1000;

/** job_runs stamps are SQLite CURRENT_TIMESTAMP: UTC, no zone marker. */
function sqliteUtc(stamp) {
  return stamp ? new Date(`${String(stamp).replace(' ', 'T')}Z`).getTime() : null;
}

function backupDue(now = new Date(), last = require('./db').getLastJobRun(JOB_NAME)) {
  const nowMs = now.getTime();
  const lastRun = sqliteUtc(last?.last_run_at);
  const lastOk = sqliteUtc(last?.succeeded_at);
  // recordJobRun clears last_error on success, so it is set only when the
  // latest attempt failed.
  if (last?.last_error && lastRun && nowMs - lastRun < RETRY_AFTER_MS) return false;
  if (!lastOk) return true;
  const sinceOk = nowMs - lastOk;
  if (sinceOk >= CATCH_UP_MS) return true;
  return now.getUTCHours() === (BACKUP_HOUR_KINSHASA + 23) % 24 && sinceOk >= MIN_GAP_MS;
}

const sqliteBackupJob = {
  name: JOB_NAME,
  shouldRun: (now) => backupDue(now),
  run: async () => {
    // eslint-disable-next-line global-require
    const engineDb = require('./db');
    const result = await runBackup({ source: engineDb.db, dbPath: engineDb.DB_PATH });
    console.log(
      `[sqlite-backup] ${result.name} (${result.bytes} B) — ` +
        `${result.uploaded ? `copied to ${result.bucket}` : 'local only'}, ` +
        `pruned ${result.prunedLocal} local / ${result.prunedRemote} remote`,
    );
    return result;
  },
};

module.exports = {
  JOB_NAME,
  BACKUP_HOUR_KINSHASA,
  RETRY_AFTER_MS,
  CATCH_UP_MS,
  sqliteBackupJob,
  backupDue,
  runBackup,
  takeSnapshot,
  pruneLocal,
  expiredNames,
  dateFromName,
  snapshotName,
  inspectDatabase,
  restoreToFile,
  supabaseRemote,
  backupDir,
  keepDays,
  bucketName,
};
