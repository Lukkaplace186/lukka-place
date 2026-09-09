/**
 * PM2 process config for production hosting — the Next.js storefront.
 *
 *   pm2 start ecosystem.config.js
 *
 * Unlike lukka-place-engine's own ecosystem.config.js, this app is stateless
 * (every request reads straight from Postgres — no in-memory per-sender
 * state), so running more than one instance would be safe if traffic ever
 * warranted it. Starting with a single instance for now; raise `instances`
 * later rather than reaching for cluster mode prematurely.
 */

module.exports = {
  apps: [
    {
      name: 'lukka-place-web',
      script: 'npm',
      args: 'start',
      cwd: __dirname,

      instances: 1,
      exec_mode: 'fork',
      watch: false,

      autorestart: true,
      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 5000,

      // Raised from 300M alongside the listing-photo budget. Next.js holds
      // a whole Server Action multipart body in memory and then copies each
      // file again for the Storage upload, so a 40 MB set of photos costs
      // roughly 90 MB on top of the ~70 MB idle baseline — and two agents
      // uploading at once would have crossed 300M. Being killed mid-request
      // is strictly worse than refusing the upload: the restart takes every
      // other in-flight request with it. See web/lib/uploadLimits.mjs; the
      // host has ~6.5 GB free, so this cap is a guardrail, not a fit.
      max_memory_restart: '768M',

      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },

      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
