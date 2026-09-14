/**
 * The name the console shows for an agency (a `vendors` row).
 *
 * `vendors.username` is NOT a name for agencies created by WhatsApp onboarding
 * or phone signup: it holds the phone digits — the same trap as
 * `agents.username` (web/CLAUDE.md). The agencies directory, the billing
 * ledger and the first receipts all printed "243853580738" as the agency.
 *
 * Resolution, in order: the username when it is not phone-shaped; else the
 * agency name one of its own agents typed (`agents.agency_name`, lowest id
 * first); else the honest "Agence #id". The phone rule is the one
 * AGENCY_NAME_EXPR (lib/listings.js) and isPhoneLikeName (lib/agentIdentity.js)
 * already apply. COALESCE stops at the first non-null, so the sub-select only
 * runs for phone-named agencies.
 *
 * A SQL fragment built from a code-supplied alias — never from user input.
 */
export function vendorNameSql(alias = 'v') {
  return `COALESCE(
    NULLIF(CASE WHEN ${alias}.username ~ '^[+]?[0-9]{7,15}$' THEN NULL ELSE TRIM(${alias}.username) END, ''),
    (SELECT NULLIF(TRIM(vn.agency_name), '') FROM agents vn
      WHERE vn.vendor_id = ${alias}.id AND NULLIF(TRIM(vn.agency_name), '') IS NOT NULL
      ORDER BY vn.id LIMIT 1),
    'Agence #' || ${alias}.id
  )`;
}
