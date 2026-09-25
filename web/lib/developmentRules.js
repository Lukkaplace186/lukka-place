/**
 * lib/developmentRules.js
 *
 * Pure rules for /projets — buildings marketed by unit type, off-plan
 * developments, and land sold in lots or portions. No database, no `t`: every
 * label is returned as an i18n KEY, resolved by the caller (web/CLAUDE.md,
 * "t in a module-level constant").
 *
 * Nothing here invents a figure. A summary ("7 dispo · dès 900 $") is derived
 * from the unit types / lots that actually carry the numbers, and a missing
 * number stays missing rather than becoming 0.
 */

export const DEVELOPMENT_KINDS = ['building', 'land'];
export const DEVELOPMENT_STAGES = ['pre_launch', 'under_construction', 'delivered'];
export const DEVELOPMENT_PURPOSES = ['sale', 'rent', 'mixed'];
export const LOT_STATUSES = ['available', 'reserved', 'sold'];
export const TITLE_STATUSES = ['own_title', 'shared_title', 'in_progress', 'unknown'];
/** Land is sold either as shares of ONE parcel (30 % / 50 % / 100 %) or as numbered lots of a lotissement. */
export const LAND_MODES = ['portions', 'lots'];

/** The public filter chips on /projets, in order. `all` is no filter. */
export const PROJECT_FILTERS = ['all', 'off_plan', 'under_construction', 'delivered', 'land'];

/** Plan coordinates: every polygon point lives in a 0..PLAN_BOX square. */
export const PLAN_BOX = 1000;

export const STAGE_LABEL_KEYS = {
  pre_launch: 'projects.stage.pre_launch',
  under_construction: 'projects.stage.under_construction',
  delivered: 'projects.stage.delivered',
};

export const LOT_STATUS_LABEL_KEYS = {
  available: 'projects.lot.available',
  reserved: 'projects.lot.reserved',
  sold: 'projects.lot.sold',
};

export const TITLE_STATUS_LABEL_KEYS = {
  own_title: 'projects.title.own_title',
  shared_title: 'projects.title.shared_title',
  in_progress: 'projects.title.in_progress',
  unknown: 'projects.title.unknown',
};

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * URL slug from a project name. Accents folded, anything else dropped. The id
 * is appended by the caller so two "Résidence Les Palmiers" never collide.
 */
export function slugify(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'projet';
}

/** `/projets/residence-les-palmiers-12` → 12. Only the trailing id matters. */
export function idFromSlug(slug) {
  const match = /(?:^|-)(\d+)$/.exec(String(slug || ''));
  if (!match) return null;
  const id = Number.parseInt(match[1], 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function projectHref(project) {
  return `/projets/${project.slug}`;
}

/**
 * Which public filter bucket a project falls in. Pre-launch and under
 * construction are both "sur plan" to a buyer; the chip for construction is
 * narrower.
 */
export function matchesProjectFilter(project, filter) {
  if (!filter || filter === 'all') return true;
  if (filter === 'land') return project.kind === 'land';
  if (project.kind !== 'building') return false;
  if (filter === 'off_plan') return project.stage === 'pre_launch' || project.stage === 'under_construction';
  return project.stage === filter;
}

/**
 * Availability and price range across a building's unit types. A unit type
 * with no stated availability does not count as zero — `available` is null
 * when NOTHING states it, so the card says nothing rather than "0 dispo".
 */
export function unitTypeSummary(unitTypes = []) {
  let available = null;
  let total = null;
  let priceMin = null;
  let priceMax = null;
  const purposes = new Set();
  const bedrooms = [];

  for (const unit of unitTypes) {
    const avail = num(unit.units_available);
    const tot = num(unit.units_total);
    if (avail !== null) available = (available ?? 0) + avail;
    if (tot !== null) total = (total ?? 0) + tot;
    const lo = num(unit.price_min) ?? num(unit.price_max);
    const hi = num(unit.price_max) ?? num(unit.price_min);
    // A sold-out type's price is still a real price, but "dès" should quote
    // something a visitor can actually get when anything is available.
    const soldOut = avail === 0;
    if (lo !== null && !soldOut) priceMin = priceMin === null ? lo : Math.min(priceMin, lo);
    if (hi !== null && !soldOut) priceMax = priceMax === null ? hi : Math.max(priceMax, hi);
    if (unit.purpose) purposes.add(unit.purpose);
    const beds = num(unit.bedrooms);
    if (beds !== null) bedrooms.push(beds);
  }

  return {
    available,
    total,
    priceMin,
    priceMax,
    purpose: purposes.size === 1 ? [...purposes][0] : purposes.size > 1 ? 'mixed' : null,
    bedsMin: bedrooms.length ? Math.min(...bedrooms) : null,
    bedsMax: bedrooms.length ? Math.max(...bedrooms) : null,
    typeCount: unitTypes.length,
  };
}

/**
 * Lots by status, plus the cheapest AVAILABLE lot. A portion that can no
 * longer be sold (portionBlockedIds) is not "available", whatever its row
 * says: it is counted apart as `blocked`.
 */
export function lotSummary(lots = []) {
  const counts = { available: 0, reserved: 0, sold: 0, blocked: 0 };
  const blocked = portionBlockedIds(lots);
  let priceMin = null;
  let areaTotal = null;
  for (const lot of lots) {
    const isBlocked = lot.status === 'available' && blocked.has(String(lot.id));
    if (isBlocked) counts.blocked += 1;
    else if (counts[lot.status] !== undefined) counts[lot.status] += 1;
    const price = num(lot.price);
    if (lot.status === 'available' && !isBlocked && price !== null) priceMin = priceMin === null ? price : Math.min(priceMin, price);
    const area = num(lot.area_m2);
    if (area !== null) areaTotal = (areaTotal ?? 0) + area;
  }
  return { ...counts, total: lots.length, priceMin, areaTotal };
}

/**
 * Portions are shares of ONE parcel, so selling one changes what is left:
 * once 30 % is sold or reserved, only 70 % remains and "100 %" can no longer
 * be bought. Returns the ids (as strings) of AVAILABLE portions whose share
 * exceeds what the sold and reserved portions leave. Derived from the
 * seller's own numbers every time — nothing is stored, so a sale that falls
 * through (sold → available) frees the others again by itself.
 */
export function portionBlockedIds(lots = []) {
  const portions = (lots || []).filter((lot) => num(lot.share_percent) !== null);
  const taken = portions
    .filter((lot) => lot.status === 'sold' || lot.status === 'reserved')
    .reduce((sum, lot) => sum + num(lot.share_percent), 0);
  const left = 100 - taken;
  const blocked = new Set();
  for (const lot of portions) {
    if (lot.status === 'available' && num(lot.share_percent) > left + 0.001) blocked.add(String(lot.id));
  }
  return blocked;
}

/** Price per m², rounded to the dollar. Null unless both numbers are real. */
export function pricePerM2(price, area) {
  const p = num(price);
  const a = num(area);
  if (p === null || a === null || a <= 0) return null;
  return Math.round(p / a);
}

/**
 * The portion selector's rows: lots that carry a share of one plot, ordered
 * smallest share first, each with its own price per m² and the saving per m²
 * against the smallest portion — the bulk discount, stated from the seller's
 * own prices. Area is taken from the lot, else derived from the plot's area
 * × share (that is arithmetic on stated numbers, not an estimate).
 */
export function portionRows(lots = [], landAreaM2 = null) {
  const plot = num(landAreaM2);
  const blocked = portionBlockedIds(lots);
  const rows = lots
    .filter((lot) => num(lot.share_percent) !== null)
    .map((lot) => {
      const share = num(lot.share_percent);
      const area = num(lot.area_m2) ?? (plot !== null ? Math.round((plot * share) / 100) : null);
      return {
        id: lot.id,
        label: lot.label,
        share,
        area,
        price: num(lot.price),
        status: lot.status,
        titleStatus: lot.title_status || null,
        perM2: pricePerM2(lot.price, area),
        blocked: blocked.has(String(lot.id)),
      };
    })
    .sort((a, b) => a.share - b.share);

  const base = rows.find((row) => row.perM2 !== null)?.perM2 ?? null;
  for (const row of rows) {
    row.savingPerM2 = base !== null && row.perM2 !== null && row.perM2 < base ? base - row.perM2 : null;
  }
  return rows;
}

/**
 * A payment plan as entered: [{label, percent}]. Returns the cleaned rows and
 * whether they sum to exactly 100 — a plan that does not is not shown to the
 * public (it would promise a total that is not the price).
 */
export function normalisePaymentPlan(plan) {
  const rows = (Array.isArray(plan) ? plan : [])
    .map((row) => ({ label: String(row?.label || '').trim().slice(0, 80), percent: num(row?.percent) }))
    .filter((row) => row.label && row.percent !== null && row.percent > 0);
  const sum = rows.reduce((acc, row) => acc + row.percent, 0);
  return { rows, sum, complete: rows.length > 0 && Math.abs(sum - 100) < 0.01 };
}

/** Each instalment in dollars for a given price. Rounding goes to the last row so the total is exact. */
export function paymentSchedule(plan, price) {
  const { rows, complete } = normalisePaymentPlan(plan);
  const total = num(price);
  if (!complete || total === null || total <= 0) return [];
  let allocated = 0;
  return rows.map((row, index) => {
    const amount = index === rows.length - 1
      ? Math.round(total - allocated)
      : Math.round((total * row.percent) / 100);
    allocated += amount;
    return { ...row, amount };
  });
}

/**
 * Parse the admin's plan-editor text into a polygon: "x,y x,y x,y" in plan
 * coordinates. Fewer than three points, or any point outside the box, is
 * refused (null) — a lot drawn off the plan is a lot the visitor cannot see.
 */
export function parsePolygon(text) {
  if (Array.isArray(text)) return validPolygon(text) ? text : null;
  const points = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => pair.split(',').map((v) => Number(v)));
  return validPolygon(points) ? points.map(([x, y]) => [Math.round(x), Math.round(y)]) : null;
}

function validPolygon(points) {
  return Array.isArray(points)
    && points.length >= 3
    && points.every((p) => Array.isArray(p) && p.length === 2
      && p.every((v) => Number.isFinite(v) && v >= 0 && v <= PLAN_BOX));
}

export function polygonToText(polygon) {
  return Array.isArray(polygon) ? polygon.map(([x, y]) => `${x},${y}`).join(' ') : '';
}

/** Centroid of a polygon's vertices — where a lot's label sits on the plan. */
export function polygonCentre(polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) return null;
  const sum = polygon.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
  return [sum[0] / polygon.length, sum[1] / polygon.length];
}

/**
 * How stale a construction timeline is. An off-plan project whose last dated
 * update is older than 90 days is flagged to the visitor — that is the whole
 * point of showing a timeline. Delivered buildings and land are never flagged.
 */
export const STALE_UPDATE_DAYS = 90;

export function timelineIsStale(project, updates = [], now = new Date()) {
  if (project.kind !== 'building' || project.stage === 'delivered') return false;
  const latest = updates.map((u) => dateOnly(u.taken_on)).filter(Boolean).sort((a, b) => b - a)[0];
  if (!latest) return false;
  return (now - latest) / 86_400_000 > STALE_UPDATE_DAYS;
}

/**
 * The map pin's label: "Projet · 7 dispo" / "Terrain · 12 lots". Returns key +
 * vars; the caller resolves it.
 */
export function projectPinLabel(project) {
  if (project.kind === 'land') {
    const lots = project.lot_summary;
    return lots && lots.available > 0
      ? { key: 'projects.pin.landLots', vars: { count: lots.available } }
      : { key: 'projects.pin.land', vars: {} };
  }
  const units = project.unit_summary;
  return units && units.available > 0
    ? { key: 'projects.pin.buildingUnits', vars: { count: units.available } }
    : { key: 'projects.pin.building', vars: {} };
}

/**
 * Validate the admin form. Returns { value, errorKey }. Only structural rules
 * live here; the commune is checked against the real location hierarchy by the
 * caller (it needs the engine's GET /locations).
 */
export function validateDevelopmentInput(input) {
  const name = String(input.name || '').trim().slice(0, 140);
  if (!name) return { errorKey: 'admin.projects.errors.name' };
  const kind = DEVELOPMENT_KINDS.includes(input.kind) ? input.kind : null;
  if (!kind) return { errorKey: 'admin.projects.errors.kind' };
  const stage = kind === 'building' && DEVELOPMENT_STAGES.includes(input.stage) ? input.stage : null;
  if (kind === 'building' && !stage) return { errorKey: 'admin.projects.errors.stage' };
  const purpose = DEVELOPMENT_PURPOSES.includes(input.purpose) ? input.purpose : 'sale';

  const lat = num(input.latitude);
  const lng = num(input.longitude);
  if ((lat === null) !== (lng === null)) return { errorKey: 'admin.projects.errors.coordinates' };
  // Kinshasa province envelope (lib/mapViewport.js KINSHASA_PROVINCE_ENVELOPE).
  if (lat !== null && (lat < -5.1 || lat > -3.9 || lng < 15.0 || lng > 16.6)) {
    return { errorKey: 'admin.projects.errors.coordinates' };
  }

  const plan = normalisePaymentPlan(input.payment_plan);
  if (plan.rows.length && !plan.complete) return { errorKey: 'admin.projects.errors.paymentPlan' };

  const delivery = input.delivery_expected ? String(input.delivery_expected).slice(0, 10) : null;
  if (delivery && !/^\d{4}-\d{2}-\d{2}$/.test(delivery)) return { errorKey: 'admin.projects.errors.delivery' };

  return {
    value: {
      name,
      kind,
      stage,
      purpose: kind === 'land' ? 'sale' : purpose,
      delivery_expected: kind === 'building' && stage !== 'delivered' ? delivery : null,
      agent_id: num(input.agent_id),
      developer_name: String(input.developer_name || '').trim().slice(0, 140) || null,
      commune: String(input.commune || '').trim() || null,
      quartier: String(input.quartier || '').trim().slice(0, 120) || null,
      address: String(input.address || '').trim().slice(0, 240) || null,
      latitude: lat,
      longitude: lng,
      description: String(input.description || '').trim().slice(0, 6000) || null,
      amenities: String(input.amenities || '')
        .split(/[\n,]/).map((s) => s.trim()).filter(Boolean).slice(0, 30),
      video_url: safeUrl(input.video_url),
      payment_plan: plan.rows,
      land_area_m2: kind === 'land' ? num(input.land_area_m2) : null,
      land_title_status: kind === 'land' && TITLE_STATUSES.includes(input.land_title_status) ? input.land_title_status : null,
      land_mode: kind === 'land' ? (LAND_MODES.includes(input.land_mode) ? input.land_mode : 'lots') : null,
    },
  };
}

/** Only an https URL survives; anything else (javascript:, relative) is dropped. */
export function safeUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A YouTube link as its privacy-enhanced embed URL, or null. Only YouTube is
 * embedded; any other video link is shown as a plain link.
 */
export function youtubeEmbedUrl(value) {
  const url = safeUrl(value);
  if (!url) return null;
  const { hostname, pathname, searchParams } = new URL(url);
  let id = null;
  if (/(^|\.)youtube\.com$/.test(hostname)) {
    id = searchParams.get('v') || (/^\/(?:shorts|embed)\/([\w-]{6,})/.exec(pathname)?.[1] ?? null);
  } else if (hostname === 'youtu.be') {
    id = pathname.slice(1).split('/')[0] || null;
  }
  return id && /^[\w-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}

export function validateUnitTypeInput(input) {
  const label = String(input.label || '').trim().slice(0, 80);
  if (!label) return { errorKey: 'admin.projects.errors.unitLabel' };
  const purpose = input.purpose === 'rent' ? 'rent' : 'sale';
  const priceMin = num(input.price_min);
  const priceMax = num(input.price_max);
  if (priceMin !== null && priceMax !== null && priceMax < priceMin) return { errorKey: 'admin.projects.errors.priceRange' };
  const total = num(input.units_total);
  const available = num(input.units_available);
  if (available !== null && available < 0) return { errorKey: 'admin.projects.errors.units' };
  if (total !== null && available !== null && available > total) return { errorKey: 'admin.projects.errors.units' };
  return {
    value: {
      label,
      purpose,
      bedrooms: num(input.bedrooms),
      bathrooms: num(input.bathrooms),
      area_m2: num(input.area_m2),
      price_min: priceMin,
      price_max: priceMax,
      price_period: purpose === 'rent' ? (input.price_period === 'year' ? 'year' : 'month') : null,
      units_total: total,
      units_available: available,
      sort_order: num(input.sort_order) ?? 0,
      category_id: num(input.category_id),
      ready_now: input.ready_now === true || input.ready_now === 'on' || input.ready_now === '1',
    },
  };
}

export function validateLotInput(input) {
  const label = String(input.label || '').trim().slice(0, 60);
  if (!label) return { errorKey: 'admin.projects.errors.lotLabel' };
  const status = LOT_STATUSES.includes(input.status) ? input.status : 'available';
  const share = num(input.share_percent);
  if (share !== null && (share <= 0 || share > 100)) return { errorKey: 'admin.projects.errors.share' };
  const polygonText = String(input.polygon || '').trim();
  const polygon = polygonText ? parsePolygon(polygonText) : null;
  if (polygonText && !polygon) return { errorKey: 'admin.projects.errors.polygon' };
  return {
    value: {
      label,
      status,
      area_m2: num(input.area_m2),
      price: num(input.price),
      share_percent: share,
      title_status: TITLE_STATUSES.includes(input.title_status) ? input.title_status : null,
      polygon,
      sort_order: num(input.sort_order) ?? 0,
    },
  };
}

/**
 * What stops a project from going public. Codes, in the order an admin should
 * fix them. The page must be worth opening: something to look at, a place,
 * and something on offer.
 */
export function publishBlockers(project) {
  const blockers = [];
  const media = [...(project.photos || []), ...(project.renders || [])].filter(Boolean);
  if (!media.length) blockers.push('media');
  if (!project.commune) blockers.push('commune');
  if (project.kind === 'building' && !(project.unit_types || []).length) blockers.push('units');
  if (project.kind === 'land' && !(project.lots || []).length) blockers.push('lots');
  return blockers;
}

/**
 * A Postgres DATE (delivery_expected, taken_on) as a UTC-midnight Date, or
 * null. node-postgres builds a DATE with the process's LOCAL components, so
 * `toISOString()` or formatting in another time zone shifts it by a day on any
 * machine not running UTC. Read the components back the way they were built,
 * then format with `timeZone: 'UTC'`. A 'YYYY-MM-DD' string is taken as is.
 */
export function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  return null;
}

/** 'YYYY-MM-DD' for a date input, from a DATE value. */
export function dateOnlyInputValue(value) {
  const d = dateOnly(value);
  return d ? d.toISOString().slice(0, 10) : '';
}

// ---------------------------------------------------------------------------
// Developer self-serve (/compte/agent/projets): the wizard, the generators
// that turn "20 lots" or "étages 1 à 5 × 4" into rows, and units as listings.
// ---------------------------------------------------------------------------

/** The wizard's steps, in order. `offre` is unit types (a building) or portions / lots (land). */
export const WIZARD_STEPS = ['etat', 'lieu', 'medias', 'offre', 'paiement', 'apercu'];

/**
 * Which steps a project has filled in — the stepper's ticks. Derived from the
 * row, never stored: a developer who deletes their last photo loses the tick.
 */
export function wizardProgress(project) {
  const media = [...(project.photos || []), ...(project.renders || [])].filter(Boolean);
  const offer = project.kind === 'land' ? (project.lots || []).length > 0 : (project.unit_types || []).length > 0;
  return {
    etat: project.kind === 'land'
      ? num(project.land_area_m2) !== null
      : Boolean(project.stage) && Boolean(project.description),
    lieu: Boolean(project.commune),
    medias: media.length > 0,
    offre: offer,
    paiement: normalisePaymentPlan(project.payment_plan).complete,
    apercu: Boolean(project.submitted_at) || (project.status === 1 && project.approve_status === 1),
  };
}

/**
 * Where a developer's project stands, from their side:
 *   draft       — being filled in, never submitted
 *   submitted   — waiting for the team
 *   changes     — the team asked for changes (a review note newer than the submission)
 *   live        — public
 *   live_edited — public, with edits the team has not looked at yet
 */
export function projectReviewState(project) {
  const live = project.status === 1 && project.approve_status === 1;
  if (live) return project.changes_pending ? 'live_edited' : 'live';
  if (project.review_note && project.reviewed_at
    && (!project.submitted_at || new Date(project.reviewed_at) >= new Date(project.submitted_at))) {
    return 'changes';
  }
  if (project.submitted_at) return 'submitted';
  return 'draft';
}

/**
 * How far a map pin may sit from its commune's centroid before it is refused
 * as a mis-tap or the wrong commune. Most communes are a few km across; the
 * peripheral ones are huge (Maluku runs ~80 km east), so they get their real
 * reach rather than a limit that refuses genuine sites.
 */
const PIN_REACH_KM = { Maluku: 60, Nsele: 30, 'Mont-Ngafula': 18, Kimbanseke: 14, Ngaliema: 14 };
const DEFAULT_PIN_REACH_KM = 8;

export function pinReachKm(commune) {
  return PIN_REACH_KM[commune] ?? DEFAULT_PIN_REACH_KM;
}

function kmBetween(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** True when the pin is plausibly inside the chosen commune (or there is nothing to check against). */
export function pinWithinCommune(point, centroid, commune) {
  if (!point || !centroid) return true;
  return kmBetween(point, centroid) <= pinReachKm(commune);
}

export const MAX_GENERATED = 300;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Individual units from a building's shape: floors `from`..`to` (0 = rez-de-
 * chaussée) × `perFloor`, in one of the two naming schemes Kinshasa buildings
 * use:
 *   letters → "1A", "1B", … ("RDC-A" on the ground floor)
 *   numbers → "101", "102", … ("R01" on the ground floor)
 * with an optional prefix ("Apt "). Capped at MAX_GENERATED — a bigger tower
 * is entered in several goes, and `truncated` says so rather than dropping
 * units silently.
 */
export function generateUnits({ from = 1, to = 1, perFloor = 1, naming = 'letters', prefix = '' } = {}) {
  const lo = Math.max(0, Math.floor(num(from) ?? 0));
  const hi = Math.min(99, Math.max(lo, Math.floor(num(to) ?? lo)));
  const per = Math.min(26, Math.max(1, Math.floor(num(perFloor) ?? 1)));
  const head = String(prefix || '').slice(0, 20);
  const units = [];
  let truncated = false;
  for (let floor = lo; floor <= hi && !truncated; floor += 1) {
    for (let n = 1; n <= per; n += 1) {
      if (units.length >= MAX_GENERATED) {
        truncated = true;
        break;
      }
      let code;
      if (naming === 'numbers') code = floor === 0 ? `R${String(n).padStart(2, '0')}` : `${floor}${String(n).padStart(2, '0')}`;
      else code = floor === 0 ? `RDC-${LETTERS[n - 1]}` : `${floor}${LETTERS[n - 1]}`;
      units.push({ label: `${head}${code}`, floor });
    }
  }
  return { units, truncated };
}

/** "20 lots de 300 m² à 12 000 $" → Lot 1 … Lot 20, each editable afterwards. */
export function generateLots({ count = 1, start = 1, area = null, price = null, prefix = 'Lot ' } = {}) {
  const n = Math.min(MAX_GENERATED, Math.max(1, Math.floor(num(count) ?? 1)));
  const first = Math.max(1, Math.floor(num(start) ?? 1));
  return Array.from({ length: n }, (_, i) => ({
    label: `${String(prefix ?? '').slice(0, 20)}${first + i}`,
    area_m2: num(area),
    price: num(price),
    status: 'available',
    share_percent: null,
    title_status: null,
    polygon: null,
    sort_order: first + i,
  }));
}

/** The share presets offered for a parcel sold in portions. */
export const PORTION_PRESETS = [25, 30, 50, 75, 100];

/**
 * A warning (never a refusal) for the portion editor: a bigger share that
 * costs MORE per m² than a smaller one is usually a typing slip. Takes
 * portionRows() output; returns the ids flagged.
 */
export function portionPriceWarnings(rows = []) {
  const flagged = new Set();
  const sorted = [...rows].filter((r) => r.perM2 !== null).sort((a, b) => a.share - b.share);
  let lowest = null;
  for (const row of sorted) {
    if (lowest !== null && row.perM2 > lowest) flagged.add(row.id);
    lowest = lowest === null ? row.perM2 : Math.min(lowest, row.perM2);
  }
  return flagged;
}

/**
 * Where one individual unit (a real listing) stands, from its own columns —
 * the three lifecycle axes the rest of the site uses:
 *   pending   — not approved yet (only the developer and the team see it)
 *   taken     — closed: let or sold (public: "Loué ✓ / Vendu ✓")
 *   reserved  — under offer
 *   withdrawn — archived, or rejected (not shown publicly)
 *   available — on the market
 */
export function unitListingState(listing) {
  if (Number(listing.approve_status) === 2) return 'withdrawn';
  if (Number(listing.approve_status) !== 1) return 'pending';
  if (listing.listing_status === 'closed') return 'taken';
  if (listing.listing_status === 'under_offer') return 'reserved';
  if (Number(listing.status) !== 1) return 'withdrawn';
  return 'available';
}

/**
 * A unit type's availability once it has individual units: COUNTED from its
 * listings, replacing whatever number was typed. `total` counts the units that
 * have been public (available, reserved or taken); pending and withdrawn ones
 * are not on offer. "dès" follows what is actually on the market. A type with
 * no individual units is returned unchanged (plus an empty `live_units`).
 */
export function withLiveUnitCounts(unitType, units = []) {
  if (!unitType.ready_now || !units.length) return { ...unitType, live_units: units, counted: false };
  const states = units.map(unitListingState);
  const shown = states.filter((s) => s === 'available' || s === 'reserved' || s === 'taken').length;
  if (shown === 0) return { ...unitType, live_units: units, counted: false };
  const available = states.filter((s) => s === 'available').length;
  const prices = units.filter((_, i) => states[i] === 'available').map((u) => num(u.price)).filter((p) => p !== null);
  return {
    ...unitType,
    live_units: units,
    units_available: available,
    units_total: shown,
    price_min: prices.length ? Math.min(...prices) : unitType.price_min,
    price_max: prices.length ? Math.max(...prices) : unitType.price_max,
    counted: true,
  };
}

/**
 * Sales progress ("68 % vendu") — only from real counts: every unit type
 * states a total and an availability (or is counted from its units), or every
 * lot has a status. Null when anything is unknown or nothing is sold yet: a
 * bar built on a guess is worse than no bar, and "0 % vendu" sells nothing.
 */
export function salesProgress(project) {
  if (project.kind === 'land') {
    const lots = project.lots || [];
    if (!lots.length) return null;
    const portions = lots.filter((l) => num(l.share_percent) !== null);
    if (portions.length === lots.length) {
      const sold = portions.filter((l) => l.status === 'sold').reduce((s, l) => s + num(l.share_percent), 0);
      return sold > 0 ? { percent: Math.min(100, Math.round(sold)), sold: null, total: null } : null;
    }
    const sold = lots.filter((l) => l.status === 'sold').length;
    return sold > 0 ? { percent: Math.round((sold / lots.length) * 100), sold, total: lots.length } : null;
  }
  const types = project.unit_types || [];
  if (!types.length) return null;
  let total = 0;
  let available = 0;
  for (const type of types) {
    const tot = num(type.units_total);
    const avail = num(type.units_available);
    if (tot === null || avail === null || tot <= 0) return null;
    total += tot;
    available += avail;
  }
  const sold = total - available;
  return sold > 0 ? { percent: Math.round((sold / total) * 100), sold, total } : null;
}

/** A unit's listing title: "Apt 3B · T3 · Résidence Lumière". */
export function unitListingTitle(project, unitType, unit) {
  return [unit.label, unitType.label, project.name].filter(Boolean).join(' · ').slice(0, 150);
}

/**
 * The description a unit's listing carries: the unit's own facts first, then
 * the project's description. Nothing is added that the developer did not say.
 */
export function unitListingDescription(project, unitType, unit) {
  const lines = [
    `${unit.label} — ${unitType.label}${unit.floor !== null && unit.floor !== undefined ? `, ${unit.floor === 0 ? 'rez-de-chaussée' : `étage ${unit.floor}`}` : ''}.`,
    `Fait partie du projet « ${project.name} »${project.commune ? ` à ${project.commune}` : ''}.`,
  ];
  if (project.description) lines.push('', project.description);
  return lines.join('\n').slice(0, 4000);
}

/** Validate one individual unit row (label, floor, price). The price may be left to the type's. */
export function validateUnitInput(input, unitType = {}) {
  const label = String(input.label || '').trim().slice(0, 40);
  if (!label) return { errorKey: 'admin.projects.errors.unitLabel' };
  const floor = num(input.floor);
  if (floor !== null && (floor < 0 || floor > 99 || !Number.isInteger(floor))) return { errorKey: 'admin.projects.errors.floor' };
  const price = num(input.price) ?? num(unitType.price_min) ?? num(unitType.price_max);
  if (price === null || price <= 0) return { errorKey: 'admin.projects.errors.unitPrice' };
  return { value: { label, floor, price } };
}
