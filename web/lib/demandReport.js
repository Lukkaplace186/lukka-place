import 'server-only';
import { getPool } from './db';
import { COMMUNE_SUBQUERY } from './listings';
import { getDemandReport } from './adminApi';
import { matchesDemandCell } from './demandRules';

/**
 * /admin/demande — what customers asked for (the engine's leads, SQLite) set
 * against what is live right now (Postgres, the public gate). The gap is the
 * number a developer wants before fixing a unit mix and a price list.
 *
 * Supply is every public listing matching the cell: same commune tag, same
 * purpose, at least the bedrooms asked, and a price inside the budget band
 * (yearly rents compared per month, the way lib/format.js renders them). A
 * listing with no usable price never counts as "within budget".
 */
export async function getDemandVsSupply({ days = 90, limit = 40 } = {}) {
  const [demand, supplyRows] = await Promise.all([
    getDemandReport({ days, limit }),
    getPool()
      .query(
        `SELECT p.id, p.purpose, p.beds, p.price, p.price_period, ${COMMUNE_SUBQUERY}
           FROM properties p
          WHERE p.status = 1 AND p.approve_status = 1`,
      )
      .then((r) => r.rows),
  ]);

  const cells = (demand.cells || []).map((cell) => {
    const supply = supplyRows.filter((row) => matchesDemandCell(row, cell)).length;
    return { ...cell, supply, gap: cell.customers - supply };
  });
  return { ...demand, cells, liveListings: supplyRows.length };
}
