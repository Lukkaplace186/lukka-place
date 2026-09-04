/**
 * Six-line .env.local reader. This app has no `dotenv` dependency (Next
 * loads .env.local itself), and these tests run outside Next — same reason
 * and same approach as web/scripts/geocode-listings.js's own loader.
 *
 * Never overwrites an already-set variable, so a test can pin a value before
 * importing this and keep it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_ROOT = path.resolve(WEB_ROOT, '..');

export function loadEnvLocal(file = path.join(WEB_ROOT, '.env.local')) {
  if (!fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!(key in process.env)) process.env[key] = trimmed.slice(eq + 1).trim();
  }
  return true;
}
