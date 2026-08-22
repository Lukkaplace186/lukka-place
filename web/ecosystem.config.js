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

      max_memory_restart: '300M',

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
