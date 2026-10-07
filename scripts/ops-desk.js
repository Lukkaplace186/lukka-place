/**
 * Set up and check Lukka Place's desk phone (OPS_WHATSAPP_NUMBER).
 * services/opsDesk.js has the why; this is the how. Run on the VPS, in the
 * engine directory:
 *
 *   node scripts/ops-desk.js status                 # what is configured, is the window open
 *   node scripts/ops-desk.js set 0812345678         # dry run: shows the line it would write
 *   node scripts/ops-desk.js set 0812345678 --write # writes OPS_WHATSAPP_NUMBER into .env
 *   pm2 restart lukka-place-engine --update-env     # the engine reads .env at boot
 *   (from the desk phone, WhatsApp "OK" to the business number — the engine answers)
 *   node scripts/ops-desk.js test                   # sends a test message to the desk
 *
 * Order matters: the desk phone has to message the business number BEFORE
 * `test`, because without an approved template Meta only delivers to a number
 * that messaged us in the last 24 hours. A `test` sent first is "accepted"
 * and never arrives.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');
// The storefront's own WhatsApp number (web's NEXT_PUBLIC_WHATSAPP_NUMBER):
// a WABA number cannot message itself, so it can never be the desk.
const BUSINESS_NUMBER = (process.env.BUSINESS_WHATSAPP_NUMBER || '243976321848').replace(/\D/g, '');

function masked(number) {
  return number ? `+${number.slice(0, 3)} … ${number.slice(-4)}` : '(none)';
}

function setEnvLine(contents, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(contents)) return contents.replace(pattern, line);
  return `${contents.replace(/\s*$/, '')}\n${line}\n`;
}

async function main() {
  const [command = 'status', arg] = process.argv.slice(2);
  const write = process.argv.includes('--write');

  if (command === 'set') {
    const { normaliseOpsNumber } = require('../services/opsDesk');
    const number = normaliseOpsNumber(arg);
    if (!number) {
      console.error(`"${arg || ''}" is not a phone number. Example: node scripts/ops-desk.js set 0812345678`);
      process.exitCode = 1;
      return;
    }
    if (number === BUSINESS_NUMBER) {
      console.error('That is the business number itself — WhatsApp cannot send it messages. Use the desk SIM.');
      process.exitCode = 1;
      return;
    }
    console.log(`Desk number : +${number}`);
    console.log(`Line        : OPS_WHATSAPP_NUMBER=${number}`);
    if (!write) {
      console.log('\nDRY RUN — re-run with --write to put it in .env.');
      return;
    }
    fs.writeFileSync(ENV_PATH, setEnvLine(fs.readFileSync(ENV_PATH, 'utf8'), 'OPS_WHATSAPP_NUMBER', number));
    console.log(`\nWritten to ${ENV_PATH}. Next:`);
    console.log('  1. pm2 restart lukka-place-engine --update-env');
    console.log(`  2. From the desk phone, WhatsApp "OK" to +${BUSINESS_NUMBER} — the engine answers within seconds.`);
    console.log('  3. node scripts/ops-desk.js test');
    return;
  }

  const opsDesk = require('../services/opsDesk');
  const status = opsDesk.deskStatus();

  if (command === 'status') {
    console.log(`Configured    : ${status.configured ? masked(status.number) : status.invalid ? 'INVALID value in .env' : 'no'}`);
    console.log(`Last desk msg : ${status.lastMessageAt || 'never'}`);
    console.log(`24h window    : ${status.windowOpen ? `open until ${status.windowOpenUntil} (UTC)` : 'CLOSED — desk copies will not arrive'}`);
    console.log(`Last reminder : ${status.reminderSentAt || 'never'}`);
    if (status.configured && !status.windowOpen) {
      console.log(`\nTo open it: from the desk phone, WhatsApp "OK" to +${BUSINESS_NUMBER}.`);
    }
    return;
  }

  if (command === 'test') {
    if (!status.configured) {
      console.error('OPS_WHATSAPP_NUMBER is not set (or not a number). Run `set` first, then restart the engine.');
      process.exitCode = 1;
      return;
    }
    if (!status.windowOpen) {
      console.warn(`Warning: the desk has not messaged +${BUSINESS_NUMBER} in the last 24h, so this will probably not arrive.`);
    }
    const chakra = require('../services/chakra');
    await chakra.sendWhatsAppMessage(
      status.number,
      '🧪 Test Lukka Place : si vous lisez ceci, le bureau recevra les demandes de visite, '
        + 'les demandes sur les annonces et les alertes techniques.',
    );
    console.log(`Sent to ${masked(status.number)}. Check the desk phone — "accepted" here is not proof of delivery.`);
    return;
  }

  console.error(`Unknown command "${command}". Use status | set <number> [--write] | test.`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
