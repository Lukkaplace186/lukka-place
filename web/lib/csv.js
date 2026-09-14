/**
 * Minimal RFC 4180 CSV for admin exports. A UTF-8 BOM leads the file so Excel
 * opens French accents correctly, and a cell that starts with = + - @ is
 * prefixed with an apostrophe so a name or a note can never run as a formula
 * in whoever opens the export.
 */

function cell(value) {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** @param {Array<[string, (row: object) => unknown]>} columns header + accessor pairs */
export function rowsToCsv(rows, columns) {
  const lines = [columns.map(([header]) => cell(header)).join(',')];
  for (const row of rows) lines.push(columns.map(([, get]) => cell(get(row))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
