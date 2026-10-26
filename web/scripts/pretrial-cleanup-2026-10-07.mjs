import { getPool } from '../lib/db.js';
import { adminSetListingVisible, adminUpdateListing } from '../lib/adminListings.js';
const WRITE = process.argv.includes('--write');
const pool = getPool();
const ACTOR = 'claude-code: pre-trial cleanup (approved by owner 2026-10-07)';

const test = await pool.query(`SELECT p.id FROM properties p WHERE p.agent_id = 33 AND p.status = 1 AND p.approve_status = 1 ORDER BY p.id`);
const ARCHIVE = [
  ...test.rows.map((r) => ({ id: Number(r.id), why: 'Agence Test (agent #33): test listing' })),
  { id: 239, why: 'no price, no rooms, no photo, address and description "N/A"' },
  { id: 197, why: 'contradictory (title: sale of a parcel in Lingwala; data: 4-bed rental, Ngiri-Ngiri address); only photo missing from storage' },
  { id: 297, why: 'duplicate of #295 (same WhatsApp message sent twice; #295 has 7 photos vs 4)' },
  { id: 226, why: 'duplicate of #253 (same Ngiri-Ngiri Saïo-UPAC listing; 2 of its 3 photos missing from storage)' },
  { id: 254, why: 'duplicate of #253 (same Ngiri-Ngiri Saïo-UPAC listing)' },
];
const FIXES = [
  { id: 270, patch: { categoryId: 36 }, why: 'category Terrain → Maison ("Tout la parcelle de 3 grande chambre…")' },
  { id: 258, patch: { commune: 'Kinshasa', quartier: 'Huilerie' }, why: 'commune tag Kinshasa ("Commune de Kinshasa" in the agent message)' },
  { id: 264, patch: { commune: 'Kalamu', quartier: 'Matonge/Kauka' }, why: 'commune tag Kalamu (Matonge is in Kalamu)' },
  { id: 259, patch: { commune: 'Ngaliema', quartier: 'Rond point safricas' }, why: 'commune tag Ngaliema ("à Gb" in the agent message; GB is in Ngaliema, confirmed by the owner)' },
  { id: 277, patch: { commune: 'Ngaliema', quartier: 'GB' }, why: 'commune tag Ngaliema ("à GB" in the agent message; GB is in Ngaliema, confirmed by the owner)' },
];

const before = await pool.query(
  `SELECT p.id, p.status, p.approve_status, p.category_id, p.quartier, pc.address,
          (SELECT string_agg(amenity_id::text, ',') FROM property_amenities a WHERE a.property_id = p.id AND a.amenity_id BETWEEN 21 AND 44) AS commune_tag
     FROM properties p LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
    WHERE p.id = ANY($1)`, [[...ARCHIVE.map((a) => a.id), ...FIXES.map((f) => f.id)]]);
console.table(before.rows);
console.log('ARCHIVE', ARCHIVE.length, ARCHIVE.map((a) => a.id).join(','));
const q = (id) => before.rows.find((r) => Number(r.id) === id);
for (const f of FIXES) if (f.patch.quartier && q(f.id)?.quartier && q(f.id).quartier !== f.patch.quartier) throw new Error(`#${f.id} quartier changed: ${q(f.id)?.quartier}`);

if (WRITE) {
  const audit = (id, action, details) => pool.query(
    `INSERT INTO console_admin_audit_log (admin_user_id, actor_label, action, entity_type, entity_id, details) VALUES (NULL, $1, $2, 'listing', $3, $4)`,
    [ACTOR, action, String(id), JSON.stringify(details)]);
  for (const a of ARCHIVE) {
    if (!(await adminSetListingVisible(a.id, false))) throw new Error(`#${a.id} not found`);
    await audit(a.id, 'listing.suspend', { reason: a.why });
  }
  for (const f of FIXES) {
    if (!(await adminUpdateListing(f.id, f.patch))) throw new Error(`#${f.id} not updated`);
    await audit(f.id, 'listing.update', { patch: f.patch, reason: f.why });
  }
  const after = await pool.query(
    `SELECT p.id, p.status, p.category_id, pc.address,
            (SELECT string_agg(amenity_id::text, ',') FROM property_amenities a WHERE a.property_id = p.id AND a.amenity_id BETWEEN 21 AND 44) AS commune_tag
       FROM properties p LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
      WHERE p.id = ANY($1) ORDER BY p.id`, [[...ARCHIVE.map((a) => a.id), ...FIXES.map((f) => f.id)]]);
  console.table(after.rows);
  const pub = await pool.query('SELECT count(*) n FROM properties WHERE status = 1 AND approve_status = 1');
  console.log('public listings now:', pub.rows[0].n);
} else console.log('DRY RUN');
await pool.end();
