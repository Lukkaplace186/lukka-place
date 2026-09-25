/**
 * lib/projectPaste.js — "Coller depuis Excel".
 *
 * Developers keep their price lists in a spreadsheet. Copying cells out of
 * Excel or Google Sheets gives tab-separated lines; a CSV export gives
 * semicolons (French-locale Excel) or commas. This turns that text into rows
 * for the wizard, each one run through the SAME validator a hand-typed row
 * goes through, so a pasted row can never hold something the form would
 * refuse.
 *
 * Pure: used by the browser for the preview and by the Server Action, which
 * re-parses the text itself rather than trusting the preview.
 *
 * Nothing is dropped silently. A line that fails validation comes back with
 * its line number and the reason, and the preview shows it in red; a header
 * line (words where numbers belong) is recognised and skipped, and said so.
 */
import { validateLotInput, validateUnitTypeInput, validateUnitInput } from './developmentRules';

export const PASTE_MAX_ROWS = 300;

/** Column order for each kind of paste — what the helper text tells the developer to copy. */
export const PASTE_COLUMNS = {
  unitTypes: ['label', 'bedrooms', 'bathrooms', 'area_m2', 'price_min', 'price_max', 'units_total', 'units_available'],
  lots: ['label', 'area_m2', 'price'],
  units: ['label', 'floor', 'price'],
};

const NUMERIC = new Set(['bedrooms', 'bathrooms', 'area_m2', 'price_min', 'price_max', 'units_total', 'units_available', 'price', 'floor']);

/**
 * A number the way it is written in Kinshasa price lists: "1 200", "1 200,50",
 * "1.200.000", "85 000 $", "USD 900", "12k". Null when there is no number.
 * A lone dot followed by exactly three digits is a thousands separator
 * ("1.200" = 1200); a comma is always the decimal mark once spaces and dots
 * are thousands.
 */
export function parseLooseNumber(value) {
  let text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  text = text.replace(/usd|us\$|\$|dollars?|m²|m2|fc|cdf/g, '').replace(/[\s  ]/g, '');
  let multiplier = 1;
  if (/k$/.test(text)) {
    multiplier = 1000;
    text = text.slice(0, -1);
  }
  if (!text || /[^0-9.,-]/.test(text)) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, '');
  else text = text.replace(',', '.');
  const n = Number(text);
  return Number.isFinite(n) ? n * multiplier : null;
}

function splitLine(line) {
  if (line.includes('\t')) return line.split('\t');
  if (line.includes(';')) return line.split(';');
  // A comma-separated line: only when splitting on commas does not break a
  // French decimal ("1 200,50" alone on a line is one cell).
  const parts = line.split(',');
  return parts.length >= 2 ? parts : [line];
}

function looksLikeHeader(cells, columns) {
  // A header has words where numbers belong, in more than one numeric column.
  let wordy = 0;
  columns.forEach((column, i) => {
    if (NUMERIC.has(column) && cells[i] && parseLooseNumber(cells[i]) === null) wordy += 1;
  });
  return wordy >= 2 || (wordy >= 1 && columns.filter((c) => NUMERIC.has(c)).length <= 2);
}

/**
 * @param {string} text   the pasted text
 * @param {'unitTypes'|'lots'|'units'} kind
 * @param {Object} [context] for `units`: the unit type, so a unit with no
 *   price of its own takes the type's price (validateUnitInput's rule)
 * @returns {{rows: Array<{line: number, value?: Object, errorKey?: string, cells: string[]}>,
 *   skippedHeader: boolean, truncated: boolean}}
 */
export function parsePastedRows(text, kind, context = {}) {
  const columns = PASTE_COLUMNS[kind];
  if (!columns) throw new Error(`unknown paste kind: ${kind}`);
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const rows = [];
  let skippedHeader = false;
  let truncated = false;

  lines.forEach((raw, index) => {
    if (!raw.trim()) return;
    const cells = splitLine(raw).map((c) => c.trim());
    if (!rows.length && !skippedHeader && looksLikeHeader(cells, columns)) {
      skippedHeader = true;
      return;
    }
    if (rows.length >= PASTE_MAX_ROWS) {
      truncated = true;
      return;
    }
    const input = {};
    columns.forEach((column, i) => {
      const cell = cells[i] ?? '';
      input[column] = NUMERIC.has(column) ? (cell === '' ? '' : parseLooseNumber(cell) ?? `invalid:${cell}`) : cell;
    });
    const invalid = columns.find((c) => NUMERIC.has(c) && String(input[c]).startsWith('invalid:'));
    if (invalid) {
      rows.push({ line: index + 1, cells, errorKey: 'admin.projects.errors.pasteNumber' });
      return;
    }
    let result;
    if (kind === 'unitTypes') result = validateUnitTypeInput({ ...input, purpose: context.purpose || 'sale', price_period: context.pricePeriod });
    else if (kind === 'lots') result = validateLotInput({ ...input, status: 'available' });
    else result = validateUnitInput(input, context.unitType || {});
    rows.push(result.errorKey
      ? { line: index + 1, cells, errorKey: result.errorKey }
      : { line: index + 1, cells, value: result.value });
  });

  return { rows, skippedHeader, truncated };
}
