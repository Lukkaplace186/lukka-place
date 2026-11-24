/**
 * A dropped Postgres connection must never take the engine down.
 *
 * The server can cut a pooled connection at any time: a Supabase restart or
 * compute change, maintenance, the pooler recycling, a network drop. node-pg
 * then emits 'error' — on the Pool for an idle connection, on the client for
 * one checked out between queries — and an 'error' event with no listener is
 * an uncaught exception: the process exits.
 *
 * On 2026-11-24 the Nano → Micro upgrade restarted Postgres and the engine
 * crashed on "terminating connection due to administrator command". PM2
 * restarted it 5 s later, but a WhatsApp verification code that arrived in
 * between got the generic intake reply instead of being checked.
 *
 * The pool already throws a dead idle connection away and opens a fresh one
 * on the next query; a query in flight rejects like any other error and its
 * caller handles that. All that was missing is someone listening. So: log
 * what happened and carry on.
 */

function describe(err) {
  return (err && (err.message || err.code)) || String(err);
}

/**
 * Listen for connection errors on `pool` and on every client it opens.
 * Idempotent per pool. Returns the pool.
 */
function handleConnectionErrors(pool, label = 'postgres') {
  if (!pool || pool.__lukkaConnectionErrorsHandled) return pool;
  pool.__lukkaConnectionErrorsHandled = true;
  // An idle client's error reaches the pool's listener; a checked-out one's
  // reaches only the client. Track which is which so each drop logs once.
  const inUse = new WeakSet();
  pool.on('acquire', (client) => inUse.add(client));
  pool.on('release', (_err, client) => inUse.delete(client));
  pool.on('error', (err) => {
    console.error(`[${label}] idle Postgres connection lost; the pool reconnects on the next query: ${describe(err)}`);
  });
  pool.on('connect', (client) => {
    client.on('error', (err) => {
      if (!inUse.has(client)) return; // idle: the pool's listener logs it
      console.error(`[${label}] Postgres connection lost while in use; that query fails, the pool reconnects: ${describe(err)}`);
    });
  });
  return pool;
}

module.exports = { handleConnectionErrors };
