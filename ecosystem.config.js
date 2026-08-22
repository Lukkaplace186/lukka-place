/**
 * PM2 process config for production hosting.
 *
 *   npm run start:prod   (== pm2 start ecosystem.config.js)
 *
 * Deliberately a single fork-mode instance, not PM2 cluster mode: this app
 * keeps per-sender state in memory (routes/webhook.js's burst-grouping
 * buffer and in-flight dedupe guard) and writes to a single local SQLite
 * file (services/db.js). Either would silently break — messages processed
 * twice, or split across workers that never see each other's state — if
 * more than one instance ran concurrently. Scale this service by giving it
 * more resources, not more instances.
 *
 * Secrets are NOT duplicated here — this file is safe to commit, `.env` is
 * not (see .gitignore). dotenv (required at the top of index.js) reads
 * `.env` from the process's cwd, which `cwd` below pins to this directory
 * regardless of where `pm2` itself was invoked from.
 */

module.exports = {
  apps: [
    {
      name: 'lukka-place-engine',
      script: 'index.js',
      cwd: __dirname,

      instances: 1,
      exec_mode: 'fork',
      watch: false,

      autorestart: true,
      // Give the process 30s to prove it's actually up before a crash counts
      // toward the restart budget below — otherwise a slow-starting boot
      // (e.g. Chakra/OpenAI being slow to respond) could look like a crash
      // loop and trip max_restarts for no real reason.
      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 5000,

      max_memory_restart: '300M',

      env: {
        NODE_ENV: 'production',
      },

      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
