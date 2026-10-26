import { FORMATS, REPORT_FORMAT } from './formats';

/**
 * The share kit's graphics as DATA: a pure function from a share pack to a
 * list of draw operations, which components/marketing/CanvasRenderer.js
 * paints onto a canvas in the agent's browser. No DOM, no canvas, no fetch —
 * so every position here is unit-testable in Node, and there is one place the
 * design lives rather than one per renderer.
 *
 * Operations (all coordinates in output pixels; text `y` is the BASELINE):
 *   { type: 'rect',  x, y, w, h, fill, radius?, shadow?: {color, blur, y}, gradient?: [top, bottom] }
 *   { type: 'image', key, x, y, w, h, fit: 'cover'|'contain', radius?, alpha? }
 *   { type: 'text',  text, x, y, size, weight, color, align: 'left'|'center'|'right', letterSpacing? }
 *   { type: 'icon',  name, x, y, size, color }  — 'whatsapp' and 'check'
 *     (lib/marketing/icons.js), or a stroked line icon from LINE_ICONS there:
 *     'pin', 'bed', 'bath', 'area', 'door'.
 *
 * Image keys: 'photo:0'..'photo:2', 'logo' (the agent's), 'mark' (the white
 * Lukka Place roofline, for a blue ground), 'markLight' (the blue + green
 * one, for the white contact bar) and 'wordmark' (the whole white logo, on
 * the feed card's photo). The caller says which of them actually loaded
 * (`photoCount`, `hasLogo`, `hasMark`, `hasMarkLight`, `hasWordmark`), and the
 * layout adapts rather than drawing an empty frame.
 *
 * `measure(text, { size, weight, letterSpacing })` returns a width in pixels.
 * The renderer passes the real canvas measurement; tests pass an estimate.
 *
 * THE LISTING CARD (2026-10-06 redesign). Rounded photo tiles on the royal
 * ground with the purpose and type as pills on the cover and "+N photos" on
 * the last tile; the price, a pin + place line and line-icon chips for the
 * counts beside the agent's own white logo card (square and 9:16); a white
 * contact bar with the agent's name and number and the Lukka Place lockup. This
 * card is what Mes biens' "Partager sur WhatsApp" sends (ListingQuickShare).
 * Text baselines use satori's half-leading model with Plus Jakarta Sans's own
 * metrics (ascender 1038, descender 222 per 1000 em, read from the TTF), the
 * model the retired server flyer used, so the report card and the flyers
 * share one vertical rhythm.
 */

export const COLORS = Object.freeze({
  royal: '#1e3aa8',
  royalDeep: '#16307e',
  ink: '#0b1120',
  gold: '#f59e0b',
  white: '#ffffff',
  tile: '#eef2ff',
  green: '#16a34a',
  // On the white contact bar: the brand green for the WhatsApp glyph (the
  // site's --green-deep), body ink for the number, a hairline and a muted URL.
  whatsapp: '#00963f',
  inkSoft: '#2c3444',
  muted: '#5c6679',
  line: '#e2e6ef',
  // The feed card's light chips and its panel text (design system porcelain / ink-800).
  porcelain: '#f2f5fb',
  inkDeep: '#111a2e',
});

/** The lift under the white elements on the blue ground. */
const SHADOW = Object.freeze({ color: 'rgba(8, 20, 70, 0.38)', blur: 28, y: 10 });

// Plus Jakarta Sans vertical metrics, per em.
const ASCENT = 1.038;
const DESCENT = 0.222;
const CONTENT = ASCENT + DESCENT;

/** Height of a line box: `lineHeight × size`, or the font's content height for `normal`. */
export function lineBox(size, lineHeight = null) {
  return lineHeight == null ? CONTENT * size : lineHeight * size;
}

/** Distance from the top of a line box to the baseline (half-leading model). */
export function baselineOffset(size, lineHeight = null) {
  return (lineBox(size, lineHeight) - CONTENT * size) / 2 + ASCENT * size;
}

const ELLIPSIS = '…';

/**
 * Greedy word wrap into at most `maxLines`, the last line ellipsised if the
 * text does not fit. A single word wider than the line is cut, not overflowed.
 */
export function wrapText(text, maxWidth, style, maxLines, measure) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const fits = (line) => measure(line, style) <= maxWidth;
  const lines = [];
  let next = 0;
  while (next < words.length && lines.length < maxLines) {
    let line = words[next];
    next += 1;
    while (next < words.length && fits(`${line} ${words[next]}`)) {
      line = `${line} ${words[next]}`;
      next += 1;
    }
    lines.push(line);
  }
  const shorten = (line) => {
    let cut = line;
    while (cut.length > 1 && !fits(cut)) {
      const body = cut.endsWith(ELLIPSIS) ? cut.slice(0, -1) : cut;
      cut = `${body.slice(0, -1).trimEnd()}${ELLIPSIS}`;
    }
    return cut;
  };
  return lines.map((line, i) => {
    const last = i === lines.length - 1;
    if (last && next < words.length) return shorten(`${line}${ELLIPSIS}`);
    return fits(line) ? line : shorten(line);
  });
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** Translucent ink, for pills and the "+N photos" veil over a photo. */
const VEIL = 'rgba(11,17,32,0.55)';

/**
 * Up to three photos as rounded tiles (2026-10-06 redesign: "bento" tiles,
 * each with its own corners) on a white backing, so the gaps between them
 * are white. `mode: 'side'` puts the cover photo left with two
 * stacked on its right; `'below'` puts it on top with two side by side
 * underneath. With no photo at all, a deep-blue tile carries the wordmark —
 * never a stand-in photo.
 *
 * `more` (photoTotal − photos drawn) veils the last tile with "+N photos": the
 * listing's real count, and the reason to open the link.
 */
function photoTiles(box, count, { mode, gap, radius, mainSize, wordmarkSize, more = 0, moreSize, gradientH = 180 }) {
  const ops = [];
  const tile = (i, x, y, w, h) => ({ type: 'image', key: `photo:${i}`, x, y, w, h, fit: 'cover', radius });

  if (count <= 0) {
    ops.push({ type: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, fill: COLORS.royalDeep, radius });
    ops.push({
      type: 'text', text: 'Lukka Place', align: 'center', size: wordmarkSize, weight: 800, color: COLORS.white,
      x: box.x + box.w / 2, y: box.y + (box.h - lineBox(wordmarkSize)) / 2 + baselineOffset(wordmarkSize),
    });
    return ops;
  }

  const tiles = [];
  if (count === 1) {
    tiles.push([0, box.x, box.y, box.w, box.h]);
  } else if (count === 2) {
    if (mode === 'side') {
      const half = (box.w - gap) / 2;
      tiles.push([0, box.x, box.y, half, box.h], [1, box.x + half + gap, box.y, half, box.h]);
    } else {
      const half = (box.h - gap) / 2;
      tiles.push([0, box.x, box.y, box.w, half], [1, box.x, box.y + half + gap, box.w, half]);
    }
  } else if (mode === 'side') {
    const side = box.w - mainSize - gap;
    const small = (box.h - gap) / 2;
    tiles.push(
      [0, box.x, box.y, mainSize, box.h],
      [1, box.x + mainSize + gap, box.y, side, small],
      [2, box.x + mainSize + gap, box.y + small + gap, side, small],
    );
  } else {
    const below = box.h - mainSize - gap;
    const half = (box.w - gap) / 2;
    tiles.push(
      [0, box.x, box.y, box.w, mainSize],
      [1, box.x, box.y + mainSize + gap, half, below],
      [2, box.x + half + gap, box.y + mainSize + gap, half, below],
    );
  }
  // White behind the tiles, so the gaps between photos read white rather
  // than blue (2026-10-06, product direction); same corners as the tiles.
  ops.push({ type: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, fill: COLORS.white, radius });
  tiles.forEach((args) => ops.push(tile(...args)));
  // A soft dark band across the top of the cover, so the white "À LOUER"
  // pill and the type pill read on a bright ceiling.
  const [, cx, cy, cw, ch] = tiles[0];
  ops.push({ type: 'rect', x: cx, y: cy, w: cw, h: Math.min(ch, gradientH), radius, gradient: ['rgba(11,17,32,0.42)', 'rgba(11,17,32,0)'] });

  // The veil goes on the last tile, and only when it is not also the cover.
  if (more > 0 && tiles.length > 1) {
    const [, x, y, w, h] = tiles[tiles.length - 1];
    const label = `+${more}`;
    const sub = more === 1 ? 'photo' : 'photos';
    const subSize = Math.round(moreSize * 0.42);
    const blockH = lineBox(moreSize, 1) + lineBox(subSize, 1.2);
    const top = y + (h - blockH) / 2;
    ops.push(
      { type: 'rect', x, y, w, h, fill: 'rgba(11,17,32,0.5)', radius },
      { type: 'text', text: label, x: x + w / 2, y: top + baselineOffset(moreSize, 1), size: moreSize, weight: 800, color: COLORS.white, align: 'center' },
      {
        type: 'text', text: sub, x: x + w / 2, y: top + lineBox(moreSize, 1) + baselineOffset(subSize, 1.2),
        size: subSize, weight: 600, color: 'rgba(255,255,255,0.88)', align: 'center',
      },
    );
  }
  return ops;
}

/**
 * Pills in a row over the cover photo: "À LOUER" in white, the property type
 * on a dark veil. A pill that would run past `maxWidth` is left out whole.
 */
function pillRow(items, { x, y, size, padX, padY, gap, maxWidth }, measure) {
  const ops = [];
  const h = lineBox(size) + padY * 2;
  let cursor = x;
  for (const item of items) {
    if (!item.text) continue;
    const style = { size, weight: 800, letterSpacing: item.letterSpacing || 0 };
    const w = measure(item.text, style) + padX * 2;
    if (cursor + w > x + maxWidth) break;
    ops.push(
      { type: 'rect', x: cursor, y, w, h, fill: item.fill, radius: h / 2, ...(item.shadow ? { shadow: item.shadow } : {}) },
      {
        type: 'text', text: item.text, x: cursor + padX, y: y + padY + baselineOffset(size), size, weight: 800,
        color: item.color, align: 'left', ...(item.letterSpacing ? { letterSpacing: item.letterSpacing } : {}),
      },
    );
    cursor += w + gap;
  }
  return ops;
}

function photoPills(pack, spec, measure) {
  return pillRow(
    [
      { text: pack.purposeLabel, fill: COLORS.white, color: COLORS.royal, letterSpacing: spec.letterSpacing, shadow: { ...SHADOW, blur: 16, y: 4 } },
      { text: pack.typeText, fill: VEIL, color: COLORS.white },
    ],
    spec,
    measure,
  );
}

/** The gold "Agent vérifié" pill. Returns its size and a placer. */
function goldBadge(label, { size, padX, padY, iconSize, gap }, measure) {
  const textW = measure(label, { size, weight: 800 });
  const h = lineBox(size) + padY * 2;
  const w = padX * 2 + iconSize + gap + textW;
  const at = (x, y) => [
    { type: 'rect', x, y, w, h, fill: COLORS.gold, radius: h / 2 },
    { type: 'icon', name: 'check', x: x + padX, y: y + (h - iconSize) / 2, size: iconSize, color: COLORS.ink },
    { type: 'text', text: label, x: x + padX + iconSize + gap, y: y + padY + baselineOffset(size), size, weight: 800, color: COLORS.ink, align: 'left' },
  ];
  return { w, h, at };
}

/**
 * The amount as drawn. formatPrice groups thousands with fr-FR's narrow
 * no-break space (U+202F), which Plus Jakarta Sans draws at almost no width —
 * "1 300 $" came out as "1300 $" on the card. A plain space reads right at
 * display size, and the canvas never wraps, so nothing is lost.
 */
export function displayAmount(amount) {
  return String(amount ?? '').replace(/[\u202f\u00a0]/g, ' ');
}

/** Price, then "/ mois" on the same baseline. */
function priceRow(pack, { x, top, size, periodSize, gap }, measure) {
  const ops = [];
  const amount = displayAmount(pack.amount);
  const amountBaseline = baselineOffset(size, 1);
  ops.push({ type: 'text', text: amount, x, y: top + amountBaseline, size, weight: 800, color: COLORS.white, align: 'left' });
  if (pack.period) {
    const amountW = measure(amount, { size, weight: 800 });
    ops.push({
      type: 'text', text: pack.period, x: x + amountW + gap, y: top + amountBaseline,
      size: periodSize, weight: 500, color: 'rgba(255,255,255,0.75)', align: 'left',
    });
  }
  return { ops, bottom: top + lineBox(size, 1) };
}

/** Map pin + "Righini, Lemba", one line. */
function placeRow(text, { x, top, width, size, iconSize, gap }, measure) {
  if (!text) return { ops: [], bottom: top, drawn: false };
  const h = Math.max(iconSize, lineBox(size));
  const [line] = wrapText(text, width - iconSize - gap, { size, weight: 700 }, 1, measure);
  return {
    drawn: true,
    bottom: top + h,
    ops: [
      { type: 'icon', name: 'pin', x, y: top + (h - iconSize) / 2, size: iconSize, color: 'rgba(255,255,255,0.85)' },
      { type: 'text', text: line, x: x + iconSize + gap, y: top + (h - lineBox(size)) / 2 + baselineOffset(size), size, weight: 700, color: COLORS.white, align: 'left' },
    ],
  };
}

/**
 * The listing's counts as chips with line icons — bed, bath, area, doors.
 * One row: a chip that would not fit is left out, never squeezed or wrapped.
 * A pack stored before the chips existed has only the joined `rooms` string;
 * its parts are drawn as icon-less chips.
 */
export function specItems(pack) {
  if (Array.isArray(pack.specs)) return pack.specs.filter((s) => s && s.text);
  return String(pack.rooms || '').split(' • ').filter(Boolean).map((text) => ({ icon: null, text }));
}

/**
 * The counts, then the reference as the last chip — on the blue, where it
 * reads clearly (it sat over the cover photo first, on product direction
 * moved here 2026-10-07). "Réf. École petits lutins" / "Annonce n° 304"
 * (sharePackData.js); a pack stored before this has no refLabel.
 */
function chipItems(pack) {
  const items = specItems(pack);
  if (!pack.refLabel) return items;
  // Right after the bedrooms and bathrooms, ahead of area and doors: on a
  // full row those give way to the reference, not the other way round.
  const after = items.filter((item) => item.icon === 'bed' || item.icon === 'bath').length;
  items.splice(after, 0, { icon: 'tag', text: pack.refLabel, shrink: true });
  return items;
}

/**
 * `rows` (default 1): the 9:16 has the height for a second row, so a chip
 * that does not fit moves down rather than being shortened or left out.
 */
const CHIPS_ON_ROYAL = Object.freeze({ fill: 'rgba(255,255,255,0.14)', icon: COLORS.white, text: COLORS.white });
const CHIPS_ON_WHITE = Object.freeze({ fill: COLORS.porcelain, icon: COLORS.royal, text: COLORS.inkDeep });

function specChips(pack, { x, top, width, size, iconSize, padX, h, gap, iconGap, rows = 1, colors = CHIPS_ON_ROYAL }, measure) {
  const ops = [];
  let cursor = x;
  let rowTop = top;
  let row = 1;
  for (let item of chipItems(pack)) {
    const chipW = (text) => padX * 2 + measure(text, { size, weight: 700 }) + (item.icon ? iconSize + iconGap : 0);
    let w = chipW(item.text);
    if (cursor + w > x + width && row < rows && cursor > x) {
      row += 1;
      cursor = x;
      rowTop += h + gap;
    }
    // The reference is shortened with "…" to the room left rather than dropped
    // (agents write landmarks, some long); never below 8 characters.
    if (item.shrink && cursor + w > x + width) {
      let text = item.text;
      while (cursor + w > x + width && text.length > 8) {
        text = `${text.slice(0, -2).trimEnd()}…`;
        w = chipW(text);
      }
      item = { ...item, text };
    }
    if (cursor + w > x + width) continue;
    ops.push({ type: 'rect', x: cursor, y: rowTop, w, h, fill: colors.fill, radius: h / 2 });
    let textX = cursor + padX;
    if (item.icon) {
      ops.push({ type: 'icon', name: item.icon, x: textX, y: rowTop + (h - iconSize) / 2, size: iconSize, color: colors.icon });
      textX += iconSize + iconGap;
    }
    ops.push({ type: 'text', text: item.text, x: textX, y: rowTop + (h - lineBox(size)) / 2 + baselineOffset(size), size, weight: 700, color: colors.text, align: 'left' });
    cursor += w + gap;
  }
  return { ops, bottom: ops.length ? rowTop + h : top, drawn: ops.length > 0 };
}

/**
 * The white contact bar along the bottom: the agent (logo or initials, name,
 * gold badge when earned, WhatsApp number) on the left, the Lukka Place
 * lockup — the white roofline on a blue app-icon tile, name and URL — on the
 * right. No agent brand: the lockup alone, centred. The lockup's words are
 * dropped (tile kept) when the agent column would otherwise get too narrow.
 */
function contactBar(pack, s, { measure, hasLogo, hasMark, hasMarkLight }) {
  const { x, y, w, h, radius, pad } = s;
  const agent = pack.agent || {};
  const hasBrand = Boolean(hasLogo || agent.initials);
  const ops = [{ type: 'rect', x, y, w, h, fill: COLORS.white, radius, shadow: SHADOW }];

  const nameW = measure('Lukka Place', { size: s.lockupName, weight: 800 });
  const urlW = measure('lukkaplace.com', { size: s.lockupUrl, weight: 600 });
  const wordsW = Math.max(nameW, urlW);
  // The colour roofline (blue + green, made for a light ground) when the
  // pack carries it; a pack stored before it existed has only the white one,
  // which goes on a blue app-icon tile instead.
  const markW = hasMarkLight ? s.tile * 1.3 : s.tile;
  const lockup = (lx, withWords) => {
    const out = [];
    if (hasMarkLight) {
      out.push({ type: 'image', key: 'markLight', x: lx, y: y + (h - markW / 2) / 2, w: markW, h: markW / 2, fit: 'contain' });
    } else {
      const tileTop = y + (h - s.tile) / 2;
      out.push({ type: 'rect', x: lx, y: tileTop, w: s.tile, h: s.tile, fill: COLORS.royal, radius: s.tile * 0.28 });
      if (hasMark) {
        const mw = s.tile * 0.74;
        out.push({ type: 'image', key: 'mark', x: lx + (s.tile - mw) / 2, y: tileTop + (s.tile - mw / 2) / 2, w: mw, h: mw / 2, fit: 'contain' });
      } else {
        out.push({
          type: 'text', text: 'LP', x: lx + s.tile / 2, y: tileTop + (s.tile - lineBox(s.tile * 0.36)) / 2 + baselineOffset(s.tile * 0.36),
          size: s.tile * 0.36, weight: 800, color: COLORS.white, align: 'center',
        });
      }
    }
    if (withWords) {
      const tx = lx + markW + s.lockupGap;
      const blockH = lineBox(s.lockupName, 1.15) + lineBox(s.lockupUrl, 1.2);
      const top = y + (h - blockH) / 2;
      out.push(
        { type: 'text', text: 'Lukka Place', x: tx, y: top + baselineOffset(s.lockupName, 1.15), size: s.lockupName, weight: 800, color: COLORS.royal, align: 'left' },
        { type: 'text', text: 'lukkaplace.com', x: tx, y: top + lineBox(s.lockupName, 1.15) + baselineOffset(s.lockupUrl, 1.2), size: s.lockupUrl, weight: 600, color: COLORS.muted, align: 'left' },
      );
    }
    return out;
  };

  if (!hasBrand) {
    const total = markW + s.lockupGap + wordsW;
    ops.push(...lockup(x + (w - total) / 2, true));
    return ops;
  }

  // Agent column first, so the lockup knows how much room is left. With
  // `avatar: 0` the logo is drawn on the blue panel instead (agentLogoCard)
  // and the bar carries only the name, badge and number.
  const avatarX = x + pad;
  const avatarY = y + (h - s.avatar) / 2;
  if (!s.avatar) {
    // nothing here
  } else if (hasLogo) {
    ops.push(
      { type: 'rect', x: avatarX, y: avatarY, w: s.avatar, h: s.avatar, fill: COLORS.line, radius: s.avatar / 2 },
      { type: 'rect', x: avatarX + 2, y: avatarY + 2, w: s.avatar - 4, h: s.avatar - 4, fill: COLORS.white, radius: s.avatar / 2 - 2 },
      { type: 'image', key: 'logo', x: avatarX + s.avatar * 0.14, y: avatarY + s.avatar * 0.14, w: s.avatar * 0.72, h: s.avatar * 0.72, fit: 'contain' },
    );
  } else {
    const size = s.avatar * 0.38;
    ops.push(
      { type: 'rect', x: avatarX, y: avatarY, w: s.avatar, h: s.avatar, fill: COLORS.royal, radius: s.avatar / 2 },
      {
        type: 'text', text: agent.initials, x: avatarX + s.avatar / 2, y: avatarY + (s.avatar - lineBox(size)) / 2 + baselineOffset(size),
        size, weight: 800, color: COLORS.white, align: 'center',
      },
    );
  }

  const colX = s.avatar ? avatarX + s.avatar + s.colGap : x + pad + 6;
  const fullLockupW = markW + s.lockupGap + wordsW;
  const withWords = x + w - pad - fullLockupW - s.divider - colX >= s.minCol;
  const lockupW = withWords ? fullLockupW : markW;
  const lockupX = x + w - pad - lockupW;
  const colW = lockupX - s.divider - colX;
  ops.push({ type: 'rect', x: lockupX - s.divider / 2 - 1, y: y + pad, w: 2, h: h - pad * 2, fill: COLORS.line });
  ops.push(...lockup(lockupX, withWords));

  const rows = [];
  if (agent.name) {
    const [line] = wrapText(agent.name, colW, { size: s.name, weight: 800 }, 1, measure);
    rows.push({ h: lineBox(s.name, 1.15), gap: 0, draw: (ty) => [{ type: 'text', text: line, x: colX, y: ty + baselineOffset(s.name, 1.15), size: s.name, weight: 800, color: COLORS.ink, align: 'left' }] });
  }
  if (agent.badge) {
    const badge = goldBadge(agent.badge, s.badge, measure);
    if (badge.w <= colW) rows.push({ h: badge.h, gap: s.rowGap, draw: (ty) => badge.at(colX, ty) });
  }
  if (agent.phone) {
    const textW = measure(agent.phone, { size: s.phone, weight: 700 });
    const rowH = Math.max(s.glyph, lineBox(s.phone));
    if (s.glyph + s.glyphGap + textW <= colW) {
      rows.push({
        h: rowH, gap: s.rowGap,
        draw: (ty) => [
          { type: 'icon', name: 'whatsapp', x: colX, y: ty + (rowH - s.glyph) / 2, size: s.glyph, color: COLORS.whatsapp },
          { type: 'text', text: agent.phone, x: colX + s.glyph + s.glyphGap, y: ty + (rowH - lineBox(s.phone)) / 2 + baselineOffset(s.phone), size: s.phone, weight: 700, color: COLORS.inkSoft, align: 'left' },
        ],
      });
    }
  }
  const colH = rows.reduce((sum, row, i) => sum + row.h + (i ? row.gap : 0), 0);
  let ty = y + (h - colH) / 2;
  rows.forEach((row, i) => {
    if (i) ty += row.gap;
    ops.push(...row.draw(ty));
    ty += row.h;
  });
  return ops;
}

/**
 * The agent's own space (2026-10-06, product direction: "the agents to have
 * their own space to shine"): a white rounded card on the blue panel, right
 * of the price, holding their logo — or their initials, large, in royal blue,
 * which is what most agents have until they upload one. Lukka Place keeps its
 * own place in the white bar. Never drawn without an agent brand: no logo and
 * no name means no card, rather than an empty white square.
 */
function agentLogoCard(pack, { x, y, size, radius }, hasLogo) {
  const agent = pack.agent || {};
  const ops = [{ type: 'rect', x, y, w: size, h: size, fill: COLORS.white, radius, shadow: SHADOW }];
  if (hasLogo) {
    const inset = size * 0.12;
    ops.push({ type: 'image', key: 'logo', x: x + inset, y: y + inset, w: size - inset * 2, h: size - inset * 2, fit: 'contain' });
  } else {
    const textSize = Math.round(size * 0.36);
    ops.push({
      type: 'text', text: agent.initials, x: x + size / 2, y: y + (size - lineBox(textSize)) / 2 + baselineOffset(textSize),
      size: textSize, weight: 800, color: COLORS.royal, align: 'center',
    });
  }
  return ops;
}

const hasAgentBrand = (pack, hasLogo) => Boolean(hasLogo || pack.agent?.initials);

/** Price, place and chips, flowing down from `top`. */
function listingBlock(pack, { x, top, width, price, place, chips }, measure) {
  const ops = [];
  const p = priceRow(pack, { x, top, ...price }, measure);
  ops.push(...p.ops);
  let y = p.bottom;
  const pl = placeRow(pack.place, { x, top: y + place.gapAbove, width, ...place }, measure);
  ops.push(...pl.ops);
  if (pl.drawn) y = pl.bottom;
  const ch = specChips(pack, { x, top: y + chips.gapAbove, width, ...chips }, measure);
  ops.push(...ch.ops);
  if (ch.drawn) y = ch.bottom;
  return { ops, bottom: y };
}

/** Height listingBlock will take, for centring it in the space it has. */
function listingBlockHeight(pack, { price, place, chips }, measure, width) {
  let h = lineBox(price.size, 1);
  if (pack.place) h += place.gapAbove + Math.max(place.iconSize, lineBox(place.size));
  // Laid out for real, so a second chip row (9:16) is counted.
  const laid = specChips(pack, { x: 0, top: 0, width, ...chips }, measure);
  if (laid.drawn) h += chips.gapAbove + laid.bottom;
  return h;
}

// ---------------------------------------------------------------------------
// Flyer formats
// ---------------------------------------------------------------------------

function moreCount(pack, photoCount) {
  const total = Number(pack.photoTotal);
  return Number.isFinite(total) && total > photoCount ? total - photoCount : 0;
}

function squareFlyer(pack, { measure, photoCount, hasLogo, hasMark, hasMarkLight }) {
  const { width: W, height: H } = FORMATS.square;
  const M = 28;
  const PHOTO = { x: M, y: M, w: W - M * 2, h: 616 };
  const BAR_H = 132;
  const barY = H - M - BAR_H;

  const ops = [{ type: 'rect', x: 0, y: 0, w: W, h: H, fill: COLORS.royal }];
  ops.push(...photoTiles(PHOTO, photoCount, {
    mode: 'side', gap: 10, radius: 26, mainSize: 676, wordmarkSize: 96, more: moreCount(pack, photoCount), moreSize: 64,
  }));
  ops.push(...photoPills(pack, { x: M + 22, y: M + 22, size: 24, padX: 20, padY: 10, gap: 10, letterSpacing: 2, maxWidth: 676 - 44 }, measure));

  const spec = {
    price: { size: 88, periodSize: 32, gap: 14 },
    place: { size: 32, iconSize: 32, gap: 10, gapAbove: 16 },
    chips: { size: 24, iconSize: 26, padX: 18, h: 52, gap: 10, iconGap: 9, gapAbove: 20 },
  };
  const room = barY - (PHOTO.y + PHOTO.h);
  const CARD = 200;
  const brand = hasAgentBrand(pack, hasLogo);
  const cardX = W - M - CARD;
  const blockW = (brand ? cardX - 24 : W - M) - (M + 8);
  const top = PHOTO.y + PHOTO.h + Math.max(28, (room - listingBlockHeight(pack, spec, measure, blockW)) / 2);
  if (brand) ops.push(...agentLogoCard(pack, { x: cardX, y: PHOTO.y + PHOTO.h + (room - CARD) / 2, size: CARD, radius: 28 }, hasLogo));
  ops.push(...listingBlock(pack, { x: M + 8, top, width: blockW, ...spec }, measure).ops);

  ops.push(...contactBar(pack, {
    x: M, y: barY, w: W - M * 2, h: BAR_H, radius: 30, pad: 24,
    avatar: 0, colGap: 18, name: 30, phone: 25, glyph: 26, glyphGap: 9, rowGap: 6,
    badge: { size: 18, padX: 12, padY: 5, iconSize: 17, gap: 6 },
    tile: 64, lockupGap: 14, lockupName: 26, lockupUrl: 20, divider: 48, minCol: 300,
  }, { measure, hasLogo, hasMark, hasMarkLight }));
  return { width: W, height: H, ops };
}

/**
 * 9:16 for WhatsApp Status / Reels / TikTok. Status draws its own chrome over
 * the top ~150px (progress bar, name) and the bottom ~160px (reply bar), so
 * the pills sit below the first and the contact bar ends above the second.
 */
function storyFlyer(pack, { measure, photoCount, hasLogo, hasMark, hasMarkLight }) {
  const { width: W, height: H } = FORMATS.story;
  const M = 32;
  const SAFE_BOTTOM = 170;
  const PHOTO = { x: M, y: M, w: W - M * 2, h: 1090 };
  const BAR_H = 164;
  const barY = H - SAFE_BOTTOM - BAR_H;

  const ops = [{ type: 'rect', x: 0, y: 0, w: W, h: H, fill: COLORS.royal }];
  ops.push(...photoTiles(PHOTO, photoCount, {
    mode: 'below', gap: 12, radius: 32, mainSize: 750, wordmarkSize: 120, more: moreCount(pack, photoCount), moreSize: 80, gradientH: 320,
  }));
  ops.push(...photoPills(pack, { x: M + 32, y: 180, size: 30, padX: 26, padY: 12, gap: 12, letterSpacing: 2, maxWidth: W - M * 2 - 64 }, measure));

  const spec = {
    // The 9:16 has room to spare: the price is the biggest thing on it.
    price: { size: 144, periodSize: 48, gap: 20 },
    place: { size: 42, iconSize: 42, gap: 12, gapAbove: 22 },
    chips: { size: 30, iconSize: 32, padX: 22, h: 64, gap: 12, iconGap: 11, gapAbove: 28, rows: 2 },
  };
  const room = barY - (PHOTO.y + PHOTO.h);
  const CARD = 248;
  const brand = hasAgentBrand(pack, hasLogo);
  const cardX = W - M - CARD;
  const blockW = (brand ? cardX - 28 : W - M) - (M + 12);
  const top = PHOTO.y + PHOTO.h + Math.max(36, (room - listingBlockHeight(pack, spec, measure, blockW)) / 2);
  if (brand) ops.push(...agentLogoCard(pack, { x: cardX, y: PHOTO.y + PHOTO.h + (room - CARD) / 2, size: CARD, radius: 34 }, hasLogo));
  ops.push(...listingBlock(pack, { x: M + 12, top, width: blockW, ...spec }, measure).ops);

  ops.push(...contactBar(pack, {
    x: M, y: barY, w: W - M * 2, h: BAR_H, radius: 36, pad: 30,
    avatar: 0, colGap: 22, name: 36, phone: 30, glyph: 32, glyphGap: 11, rowGap: 8,
    badge: { size: 22, padX: 14, padY: 6, iconSize: 21, gap: 7 },
    tile: 80, lockupGap: 16, lockupName: 30, lockupUrl: 23, divider: 56, minCol: 340,
  }, { measure, hasLogo, hasMark, hasMarkLight }));
  return { width: W, height: H, ops };
}

/** 16:9 for Facebook link posts, X and LinkedIn: photos left, text panel right. */
function landscapeFlyer(pack, { measure, photoCount, hasLogo, hasMark, hasMarkLight }) {
  const { width: W, height: H } = FORMATS.landscape;
  const M = 24;
  const PHOTO = { x: M, y: M, w: 660, h: H - M * 2 };
  const x = PHOTO.x + PHOTO.w + 32;
  const width = W - x - M;
  const BAR_H = 104;
  const barY = H - M - BAR_H;

  const ops = [{ type: 'rect', x: 0, y: 0, w: W, h: H, fill: COLORS.royal }];
  ops.push(...photoTiles(PHOTO, photoCount, {
    mode: 'below', gap: 8, radius: 20, mainSize: 410, gradientH: 120, wordmarkSize: 64, more: moreCount(pack, photoCount), moreSize: 44,
  }));
  ops.push(...photoPills(pack, { x: M + 16, y: M + 16, size: 17, padX: 14, padY: 7, gap: 8, letterSpacing: 1.5, maxWidth: PHOTO.w - 32 }, measure));

  const spec = {
    price: { size: 60, periodSize: 24, gap: 10 },
    place: { size: 24, iconSize: 24, gap: 8, gapAbove: 14 },
    chips: { size: 17, iconSize: 18, padX: 12, h: 38, gap: 8, iconGap: 6, gapAbove: 16 },
  };
  const top = M + Math.max(16, (barY - M - listingBlockHeight(pack, spec, measure, width)) / 2);
  ops.push(...listingBlock(pack, { x, top, width, ...spec }, measure).ops);

  ops.push(...contactBar(pack, {
    x: x - 8, y: barY, w: width + 8, h: BAR_H, radius: 24, pad: 16,
    avatar: 64, colGap: 14, name: 21, phone: 18, glyph: 19, glyphGap: 7, rowGap: 4,
    badge: { size: 14, padX: 9, padY: 4, iconSize: 13, gap: 5 },
    tile: 52, lockupGap: 10, lockupName: 19, lockupUrl: 15, divider: 28, minCol: 220,
  }, { measure, hasLogo, hasMark, hasMarkLight }));
  return { width: W, height: H, ops };
}

/** "lukkaplace.com/listings/387" — the listing's address as printed on the feed card. */
export function feedListingPath(pack) {
  const id = Number(pack.listingId);
  return Number.isSafeInteger(id) && id > 0 ? `lukkaplace.com/listings/${id}` : 'lukkaplace.com';
}

/** "Appartement à louer": the type, then the purpose in words; the place when neither is known. */
export function feedHeading(pack) {
  const purpose = pack.purposeLabel ? pack.purposeLabel.toLowerCase() : '';
  return [pack.typeText, purpose].filter(Boolean).join(' ') || pack.place || 'Lukka Place';
}

/**
 * "Carte feed social" (2026-10-26), 4:5 for the Instagram and Facebook feeds,
 * from the design canvas: the cover photo full width over the top 900px, the
 * price on a royal badge top-left and the white Lukka Place wordmark top-right,
 * then a white panel (heading, place, light chips) and a royal band saying how
 * to reach the agent.
 *
 * One photo, not tiles: a feed post is seen small, and one photo reads where
 * three would be stamps. "N photos" on it is the listing's real count.
 *
 * "Vérifié par Lukka Place" only when the team verified the PROPERTY
 * (`properties.verified_at`, the pack's `verified`) — never the agent's tier,
 * which the gold badge on the other formats already carries.
 *
 * The band always leads back to the platform (product direction 2026-10-26:
 * the company posts this card, and when an agent posts it, it must bring
 * people back to Lukka Place): "Voir ce bien sur Lukka Place" and the
 * listing's own address, typed out because Instagram does not open a link in
 * a caption. No agent number on it — the listing page shows the agent's
 * contact under its own verified + routing rule, and the visit request there
 * is the path we can measure. The square card, sent on WhatsApp, keeps the
 * agent's number as before.
 */
function feedFlyer(pack, { measure, photoCount, hasWordmark, hasMarkLight }) {
  const { width: W, height: H } = FORMATS.feed;
  const M = 56;
  const PHOTO_H = 900;
  const BAND_H = 160;
  const bandY = H - BAND_H;
  const ops = [{ type: 'rect', x: 0, y: 0, w: W, h: H, fill: COLORS.white }];

  if (photoCount > 0) ops.push({ type: 'image', key: 'photo:0', x: 0, y: 0, w: W, h: PHOTO_H, fit: 'cover' });
  else ops.push({ type: 'rect', x: 0, y: 0, w: W, h: PHOTO_H, fill: COLORS.royalDeep });
  // Under the badge and the wordmark, so both read on a bright ceiling.
  ops.push({ type: 'rect', x: 0, y: 0, w: W, h: 340, gradient: ['rgba(11,17,32,0.58)', 'rgba(11,17,32,0)'] });

  const LOGO_W = 240;
  const LOGO_H = 76;
  const logoX = W - M - LOGO_W;
  if (hasWordmark) {
    ops.push({ type: 'image', key: 'wordmark', x: logoX, y: 66, w: LOGO_W, h: LOGO_H, fit: 'contain' });
  } else {
    ops.push({ type: 'text', text: 'Lukka Place', x: W - M, y: 66 + baselineOffset(40, 1) + (LOGO_H - 40) / 2, size: 40, weight: 800, color: COLORS.white, align: 'right' });
  }

  // The price badge, as wide as its content and never into the wordmark.
  const padX = 36;
  const maxInner = logoX - 32 - M - padX * 2;
  const labelStyle = { size: 22, weight: 800, letterSpacing: 3 };
  const label = [pack.purposeLabel, pack.typeText ? pack.typeText.toUpperCase() : null].filter(Boolean).join(' · ');
  const [labelLine] = label ? wrapText(label, maxInner, labelStyle, 1, measure) : [];
  const amount = displayAmount(pack.amount);
  const periodOf = (size) => Math.round(size * 0.385);
  const priceWidth = (size) => measure(amount, { size, weight: 800 })
    + (pack.period ? 14 + measure(pack.period, { size: periodOf(size), weight: 600 }) : 0);
  const priceSize = [104, 92, 80, 68, 56].find((size) => priceWidth(size) <= maxInner) || 56;
  const labelH = labelLine ? lineBox(22, 1) + 14 : 0;
  const innerW = Math.max(labelLine ? measure(labelLine, labelStyle) : 0, priceWidth(priceSize));
  const badgeH = 26 + labelH + lineBox(priceSize, 1) + 30;
  ops.push({ type: 'rect', x: M, y: M, w: innerW + padX * 2, h: badgeH, fill: COLORS.royal, radius: 24, shadow: { color: 'rgba(12,29,80,0.6)', blur: 60, y: 24 } });
  let ty = M + 26;
  if (labelLine) {
    ops.push({ type: 'text', text: labelLine, x: M + padX, y: ty + baselineOffset(22, 1), size: 22, weight: 800, color: 'rgba(255,255,255,0.84)', align: 'left', letterSpacing: 3 });
    ty += labelH;
  }
  const priceBaseline = ty + baselineOffset(priceSize, 1);
  ops.push({ type: 'text', text: amount, x: M + padX, y: priceBaseline, size: priceSize, weight: 800, color: COLORS.white, align: 'left' });
  if (pack.period) {
    ops.push({
      type: 'text', text: pack.period, x: M + padX + measure(amount, { size: priceSize, weight: 800 }) + 14, y: priceBaseline,
      size: periodOf(priceSize), weight: 600, color: 'rgba(255,255,255,0.84)', align: 'left',
    });
  }

  // Capsules along the bottom of the photo.
  const pillSize = 26;
  const pillH = lineBox(pillSize) + 28;
  const pillY = PHOTO_H - 48 - pillH;
  if (pack.verified) {
    const text = 'Vérifié par Lukka Place';
    const w = 48 + 30 + 12 + measure(text, { size: pillSize, weight: 700 });
    ops.push(
      { type: 'rect', x: M, y: pillY, w, h: pillH, fill: COLORS.white, radius: pillH / 2, shadow: { color: 'rgba(16,26,46,0.25)', blur: 16, y: 6 } },
      { type: 'icon', name: 'badgeCheck', x: M + 24, y: pillY + (pillH - 30) / 2, size: 30, color: COLORS.royal },
      { type: 'text', text, x: M + 24 + 30 + 12, y: pillY + 14 + baselineOffset(pillSize), size: pillSize, weight: 700, color: COLORS.royalDeep, align: 'left' },
    );
  }
  const total = Number(pack.photoTotal);
  if (photoCount > 0 && Number.isFinite(total) && total > 1) {
    const text = `${total} photos`;
    const w = 44 + 26 + 10 + measure(text, { size: 24, weight: 700 });
    const x = W - M - w;
    const h = lineBox(24) + 28;
    const y = PHOTO_H - 48 - h;
    ops.push(
      { type: 'rect', x, y, w, h, fill: 'rgba(12,29,80,0.62)', radius: h / 2 },
      { type: 'icon', name: 'image', x: x + 22, y: y + (h - 26) / 2, size: 26, color: COLORS.white },
      { type: 'text', text, x: x + 22 + 26 + 10, y: y + 14 + baselineOffset(24), size: 24, weight: 700, color: COLORS.white, align: 'left' },
    );
  }

  // The panel: heading, place, chips.
  const textW = W - M * 2;
  let y = PHOTO_H + 42;
  const [heading] = wrapText(feedHeading(pack), textW, { size: 52, weight: 700 }, 1, measure);
  ops.push({ type: 'text', text: heading, x: M, y: y + baselineOffset(52, 1.08), size: 52, weight: 700, color: COLORS.ink, align: 'left' });
  y += lineBox(52, 1.08) + 18;
  if (pack.place) {
    const rowH = Math.max(38, lineBox(34));
    const [line] = wrapText(pack.place, textW - 50, { size: 34, weight: 600 }, 1, measure);
    ops.push(
      { type: 'icon', name: 'pin', x: M, y: y + (rowH - 38) / 2, size: 38, color: COLORS.royal },
      { type: 'text', text: line, x: M + 50, y: y + (rowH - lineBox(34)) / 2 + baselineOffset(34), size: 34, weight: 600, color: COLORS.inkSoft, align: 'left' },
    );
    y += rowH;
  }
  ops.push(...specChips(pack, {
    x: M, top: y + 24, width: textW, size: 27, iconSize: 32, padX: 22, h: 60, gap: 16, iconGap: 12, colors: CHIPS_ON_WHITE,
  }, measure).ops);

  // The band: the way back to the listing on the platform. A white disc with
  // the colour roofline when the pack carries it.
  ops.push({ type: 'rect', x: 0, y: bandY, w: W, h: BAND_H, fill: COLORS.royalDeep });
  let tx = M;
  if (hasMarkLight) {
    const C = 76;
    const cy = bandY + (BAND_H - C) / 2;
    const mw = C * 0.7;
    ops.push(
      { type: 'rect', x: M, y: cy, w: C, h: C, fill: COLORS.white, radius: C / 2 },
      { type: 'image', key: 'markLight', x: M + (C - mw) / 2, y: cy + (C - mw / 2) / 2, w: mw, h: mw / 2, fit: 'contain' },
    );
    tx = M + C + 26;
  }
  const tw = W - M - tx;
  const [line1] = wrapText('Voir ce bien sur Lukka Place', tw, { size: 36, weight: 700 }, 1, measure);
  const [line2] = wrapText(`${feedListingPath(pack)} · visite et contact de l’agent`, tw, { size: 25, weight: 500 }, 1, measure);
  const blockH = lineBox(36, 1.1) + 10 + lineBox(25, 1.2);
  const top = bandY + (BAND_H - blockH) / 2;
  ops.push(
    { type: 'text', text: line1, x: tx, y: top + baselineOffset(36, 1.1), size: 36, weight: 700, color: COLORS.white, align: 'left' },
    { type: 'text', text: line2, x: tx, y: top + lineBox(36, 1.1) + 10 + baselineOffset(25, 1.2), size: 25, weight: 500, color: 'rgba(255,255,255,0.86)', align: 'left' },
  );
  return { width: W, height: H, ops };
}

const FLYERS = { square: squareFlyer, story: storyFlyer, landscape: landscapeFlyer, feed: feedFlyer };

/**
 * @param {object} pack  See lib/marketing/sharePackData.js buildFlyerPack.
 * @param {'square'|'story'|'landscape'|'feed'} formatKey
 * @param {{measure: Function, photoCount: number, hasLogo: boolean, hasMark: boolean, hasMarkLight?: boolean,
 *          hasWordmark?: boolean}} env
 */
export function buildFlyerOps(pack, formatKey, env) {
  const flyer = FLYERS[formatKey];
  if (!flyer) throw new Error(`unknown flyer format: ${formatKey}`);
  return flyer(pack, {
    ...env,
    photoCount: Math.max(0, Math.min(3, env.photoCount || 0)),
    hasLogo: Boolean(env.hasLogo),
    hasMark: Boolean(env.hasMark),
    hasMarkLight: Boolean(env.hasMarkLight),
    hasWordmark: Boolean(env.hasWordmark),
  });
}

// ---------------------------------------------------------------------------
// Landlord report card
// ---------------------------------------------------------------------------

/**
 * "Rapport de diffusion" — the weekly proof-of-work card an agent sends the
 * property owner. Four real counts with the previous week beside each; a
 * count the server could not establish (`null`) prints "—" and says so,
 * never 0. The small print under the tiles says what the numbers cover.
 *
 * @param {object} report  See lib/marketing/mandateReport.js.
 */
export function buildReportOps(report, { measure, hasPhoto, hasMark }) {
  const { width: W, height: H } = REPORT_FORMAT;
  const PAD = 48;
  const HEADER_H = 300;
  const FOOTER_TOP = 956;
  const ops = [
    { type: 'rect', x: 0, y: 0, w: W, h: H, fill: COLORS.white },
    { type: 'rect', x: 0, y: 0, w: W, h: HEADER_H, fill: COLORS.royal },
  ];

  const PHOTO = 212;
  const textW = (hasPhoto ? W - PAD - PHOTO - 36 : W) - PAD * (hasPhoto ? 1 : 2);
  if (hasPhoto) {
    ops.push({ type: 'image', key: 'photo:0', x: W - PAD - PHOTO, y: 44, w: PHOTO, h: PHOTO, fit: 'cover', radius: 24 });
  }
  ops.push({ type: 'text', text: 'RAPPORT DE DIFFUSION', x: PAD, y: 92, size: 24, weight: 800, color: 'rgba(255,255,255,0.8)', align: 'left', letterSpacing: 3 });
  // Shrink before cutting: the commune at the end of the title is the part an
  // owner looks for, and an ellipsis would take it first.
  const titleSize = [40, 36, 32, 28].find((size) => measure(report.title, { size, weight: 800 }) <= textW) || 28;
  const [title] = wrapText(report.title, textW, { size: titleSize, weight: 800 }, 1, measure);
  ops.push({ type: 'text', text: title || '', x: PAD, y: 150, size: titleSize, weight: 800, color: COLORS.white, align: 'left' });
  if (report.priceText) {
    const [price] = wrapText(report.priceText, textW, { size: 30, weight: 500 }, 1, measure);
    ops.push({ type: 'text', text: price, x: PAD, y: 198, size: 30, weight: 500, color: 'rgba(255,255,255,0.88)', align: 'left' });
  }
  ops.push({ type: 'text', text: report.periodText, x: PAD, y: 250, size: 26, weight: 500, color: 'rgba(255,255,255,0.75)', align: 'left' });

  const TILE_W = (W - PAD * 2 - 24) / 2;
  const TILE_H = 236;
  report.tiles.slice(0, 4).forEach((tile, i) => {
    const tx = PAD + (i % 2) * (TILE_W + 24);
    const ty = HEADER_H + 32 + Math.floor(i / 2) * (TILE_H + 24);
    ops.push({ type: 'rect', x: tx, y: ty, w: TILE_W, h: TILE_H, fill: COLORS.tile, radius: 28 });
    ops.push({ type: 'text', text: tile.label, x: tx + 32, y: ty + 62, size: 28, weight: 500, color: 'rgba(11,17,32,0.72)', align: 'left' });
    ops.push({ type: 'text', text: tile.value, x: tx + 32, y: ty + 164, size: 92, weight: 800, color: COLORS.royal, align: 'left' });
    if (tile.note) {
      const [note] = wrapText(tile.note, TILE_W - 64, { size: 23, weight: 500 }, 1, measure);
      ops.push({ type: 'text', text: note, x: tx + 32, y: ty + 208, size: 23, weight: 500, color: 'rgba(11,17,32,0.55)', align: 'left' });
    }
  });

  const tilesBottom = HEADER_H + 32 + TILE_H * 2 + 24;
  ops.push({ type: 'rect', x: PAD, y: tilesBottom + 30, w: 18, h: 18, fill: report.live ? COLORS.green : COLORS.gold, radius: 9 });
  ops.push({ type: 'text', text: report.statusText, x: PAD + 30, y: tilesBottom + 47, size: 28, weight: 800, color: COLORS.ink, align: 'left' });
  // "Partagée N fois", right-aligned on the status row, only when there is one
  // (buildMandateReport leaves it null at zero or unknown). The caption carries
  // what a share is; the card has no room for the definition.
  if (report.shareText) {
    const statusW = measure(report.statusText, { size: 28, weight: 800 });
    const room = W - PAD * 2 - 30 - statusW - 32;
    const [shareLine] = room > 120 ? wrapText(report.shareText, room, { size: 26, weight: 500 }, 1, measure) : [];
    if (shareLine) {
      ops.push({ type: 'text', text: shareLine, x: W - PAD, y: tilesBottom + 47, size: 26, weight: 500, color: 'rgba(11,17,32,0.72)', align: 'right' });
    }
  }
  const [footnote] = wrapText(report.footnote, W - PAD * 2, { size: 21, weight: 500 }, 1, measure);
  ops.push({ type: 'text', text: footnote, x: PAD, y: tilesBottom + 88, size: 21, weight: 500, color: 'rgba(11,17,32,0.55)', align: 'left' });

  ops.push({ type: 'rect', x: 0, y: FOOTER_TOP, w: W, h: H - FOOTER_TOP, fill: COLORS.royal });
  let brandX = PAD;
  if (hasMark) {
    ops.push({ type: 'image', key: 'mark', x: PAD, y: FOOTER_TOP + 34, w: 100, h: 50, fit: 'contain' });
    brandX = PAD + 118;
  }
  ops.push({ type: 'text', text: 'Lukka Place', x: brandX, y: FOOTER_TOP + 76, size: 36, weight: 800, color: COLORS.white, align: 'left' });
  if (report.agentName) {
    const [name] = wrapText(report.agentName, 420, { size: 26, weight: 800 }, 1, measure);
    ops.push({ type: 'text', text: name, x: W - PAD, y: report.agentPhone ? FOOTER_TOP + 52 : FOOTER_TOP + 72, size: 26, weight: 800, color: COLORS.white, align: 'right' });
  }
  if (report.agentPhone) {
    ops.push({ type: 'text', text: report.agentPhone, x: W - PAD, y: FOOTER_TOP + 92, size: 24, weight: 500, color: 'rgba(255,255,255,0.85)', align: 'right' });
  }
  return { width: W, height: H, ops };
}
