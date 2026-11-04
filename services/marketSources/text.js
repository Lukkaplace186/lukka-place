'use strict';

/**
 * Small text helpers shared by the market collectors. No HTML parser
 * dependency: every source here is read from a few stable class names or
 * JSON fields, and a regex over those is easier to keep honest than a DOM.
 */

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»',
  eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô',
  icirc: 'î', ucirc: 'û', ugrave: 'ù', euml: 'ë', iuml: 'ï', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', hellip: '…', ndash: '–', mdash: '—', Eacute: 'É', Agrave: 'À',
};

function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return NAMED[code] ?? whole;
  });
}

/** Markup → plain text, one space between pieces. */
function stripTags(html) {
  return decodeEntities(String(html ?? '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lower case, accents removed — for keyword tests only. */
function fold(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * "2 000", "4,000", "3.500", "210000.00" → a number. Thousands separators
 * (space, comma, dot followed by exactly three digits) are dropped; a final
 * ".00" / ",5" is a decimal part.
 */
function parseAmount(text) {
  let s = String(text ?? '').replace(/[\s  ]/g, '');
  if (!/\d/.test(s)) return null;
  s = s.replace(/[^\d.,]/g, '');
  const decimal = /[.,](\d{1,2})$/.exec(s);
  let integerPart = decimal ? s.slice(0, decimal.index) : s;
  integerPart = integerPart.replace(/[.,]/g, '');
  const value = Number(`${integerPart}${decimal ? `.${decimal[1]}` : ''}`);
  return Number.isFinite(value) ? value : null;
}

/** "/ mois", "le mois", "par an", "/ jour", "la nuitée" → our price_period. */
function periodFromText(text) {
  const t = fold(text);
  if (/\b(jour|journee|nuit|nuitee|day|night)\b/.test(t)) return 'jour';
  if (/\b(semaine|week)\b/.test(t)) return 'semaine';
  if (/\b(an|annee|annuel|year|yearly)\b/.test(t)) return 'an';
  if (/\b(mois|mensuel|month|monthly)\b/.test(t)) return 'mois';
  return null;
}

function isFurnished(text) {
  const t = fold(text);
  if (/\bnon[\s-]*meubl/.test(t) || /\bunfurnished\b/.test(t)) return false;
  if (/\bmeubl/.test(t) || /\bfurnished\b/.test(t)) return true;
  return null;
}

/** "à louer" / "for rent" → 'rent'; "à vendre" / "for sale" → 'sale'. */
function purposeFromText(text) {
  const t = fold(text);
  const rent = /\b(a louer|louer|location|for rent|to rent|rent)\b/.test(t);
  const sale = /\b(a vendre|vendre|vente|for sale|sale)\b/.test(t);
  if (rent && !sale) return 'rent';
  if (sale && !rent) return 'sale';
  return null;
}

module.exports = { decodeEntities, stripTags, fold, parseAmount, periodFromText, isFurnished, purposeFromText };
