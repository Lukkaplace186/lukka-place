/**
 * One-off CLI utility: generates an ADMIN_PASSWORD_HASH value for
 * .env.local, in the `salt:hash` format lib/adminAuth.js expects.
 *
 * Usage:
 *   node scripts/hash-admin-password.js "your-password-here"
 *
 * Deliberately not run automatically anywhere, and deliberately never
 * invents/chooses the actual password itself — whoever runs this supplies
 * the real one.
 */
const crypto = require('crypto');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-admin-password.js "<password>"');
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');

console.log(`ADMIN_PASSWORD_HASH=${salt}:${hash}`);
