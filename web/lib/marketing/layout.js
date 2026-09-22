import { FORMATS, REPORT_FORMAT } from './formats';

/**
 * The share kit's graphics as DATA: a pure function from a share pack to a
 * list of draw operations, which components/marketing/CanvasRenderer.js
 * paints onto a canvas in the agent's browser. No DOM, no canvas, no fetch —
 * so every position here is unit-testable in Node, and there is one place the
 * design lives rather than one per renderer.
 *
 * Operations (all coordinates in output pixels; text `y` is the BASELINE):
 *   { type: 'rect',  x, y, w, h, fill, radius? }
 *   { type: 'image', key, x, y, w, h, fit: 'cover'|'contain', radius? }
 *   { type: 'text',  text, x, y, size, weight, color, align: 'left'|'center'|'right', letterSpacing? }
 *   { type: 'icon',  name: 'whatsapp'|'check', x, y, size, color }
 *
 * Image keys: 'photo:0'..'photo:2', 'logo' (the agent's), 'mark' (the Lukka
 * Place roofline). The caller says which of them actually loaded
 * (`photoCount`, `hasLogo`, `hasMark`), and the layout adapts rather than
 * drawing an empty frame.
 *
 * `measure(text, { size, weight, letterSpacing })` returns a width in pixels.
 * The renderer passes the real canvas measurement; tests pass an estimate.
 *
 * THE SQUARE FORMAT REPRODUCES THE SERVER FLYER
 * (app/compte/agent/biens/[id]/visuel/route.js), position for position. Its
 * text baselines are derived the way satori lays text out — a line box of
 * `lineHeight × size` (or the font's ascent + descent for `normal`) with the
 * glyphs centred in it — using Plus Jakarta Sans's own metrics (ascender
 * 1038, descender 222 per 1000 em, read from the TTF). Change one, change the
 * other, until the server route is retired.
 */

export const COLORS = Object.freeze({
  royal: '#1e3aa8',
  royalDeep: '#16307e',
  ink: '#0b1120',
  gold: '#f59e0b',
  white: '#ffffff',
  tile: '#eef2ff',
  green: '#16a34a',
});

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

/**
 * Up to three photos in a box. `mode: 'side'` puts the cover photo left with
 * two stacked on its right (the square flyer); `'below'` puts it on top with
 * two side by side underneath. The gaps are the white ground showing through.
 */
function photoGrid(box, count, { mode, gap, mainSize, wordmarkSize }) {
  const ops = [{ type: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, fill: COLORS.white }];
  const photo = (i, x, y, w, h) => ({ type: 'image', key: `photo:${i}`, x, y, w, h, fit: 'cover' });

  if (count <= 0) {
    ops.push({ type: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, fill: COLORS.royalDeep });
    ops.push({
      type: 'text', text: 'Lukka Place', align: 'center', size: wordmarkSize, weight: 800, color: COLORS.white,
      x: box.x + box.w / 2, y: box.y + (box.h - lineBox(wordmarkSize)) / 2 + baselineOffset(wordmarkSize),
    });
    return ops;
  }
  if (count === 1) {
    ops.push(photo(0, box.x, box.y, box.w, box.h));
    return ops;
  }
  if (count === 2) {
    if (mode === 'side') {
      const half = (box.w - gap) / 2;
      ops.push(photo(0, box.x, box.y, half, box.h), photo(1, box.x + half + gap, box.y, half, box.h));
    } else {
      const half = (box.h - gap) / 2;
      ops.push(photo(0, box.x, box.y, box.w, half), photo(1, box.x, box.y + half + gap, box.w, half));
    }
    return ops;
  }
  if (mode === 'side') {
    const side = box.w - mainSize - gap;
    const small = (box.h - gap) / 2;
    ops.push(
      photo(0, box.x, box.y, mainSize, box.h),
      photo(1, box.x + mainSize + gap, box.y, side, small),
      photo(2, box.x + mainSize + gap, box.y + small + gap, side, small),
    );
  } else {
    const below = box.h - mainSize - gap;
    const half = (box.w - gap) / 2;
    ops.push(
      photo(0, box.x, box.y, box.w, mainSize),
      photo(1, box.x, box.y + mainSize + gap, half, below),
      photo(2, box.x + half + gap, box.y + mainSize + gap, half, below),
    );
  }
  return ops;
}

/** "À LOUER" on a white pill. */
function purposePill(label, { x, y, size, padX, padY, letterSpacing }, measure) {
  if (!label) return [];
  const style = { size, weight: 800, letterSpacing };
  const w = measure(label, style) + padX * 2;
  const h = lineBox(size) + padY * 2;
  return [
    { type: 'rect', x, y, w, h, fill: COLORS.white, radius: h / 2 },
    { type: 'text', text: label, x: x + padX, y: y + padY + baselineOffset(size), size, weight: 800, color: COLORS.royal, align: 'left', letterSpacing },
  ];
}

/** The gold "Agent vérifié" pill. Returns its ops and size so callers can place it. */
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

/** WhatsApp glyph + number. */
function phoneRow(phone, { size, iconSize, gap, weight }, measure) {
  const textW = measure(phone, { size, weight });
  const h = Math.max(iconSize, lineBox(size));
  const w = iconSize + gap + textW;
  const at = (x, y) => [
    { type: 'icon', name: 'whatsapp', x, y: y + (h - iconSize) / 2, size: iconSize, color: COLORS.white },
    { type: 'text', text: phone, x: x + iconSize + gap, y: y + (h - lineBox(size)) / 2 + baselineOffset(size), size, weight, color: COLORS.white, align: 'left' },
  ];
  return { w, h, at };
}

/** The white card holding the agent's logo, or their initials. */
function agentCard(agent, { x, y, size, radius, pad, initialsSize }, hasLogo) {
  const ops = [{ type: 'rect', x, y, w: size, h: size, fill: COLORS.white, radius }];
  if (hasLogo) {
    ops.push({ type: 'image', key: 'logo', x: x + pad, y: y + pad, w: size - pad * 2, h: size - pad * 2, fit: 'contain' });
  } else if (agent.initials) {
    ops.push({
      type: 'text', text: agent.initials, align: 'center', size: initialsSize, weight: 800, color: COLORS.royal,
      x: x + size / 2, y: y + (size - lineBox(initialsSize)) / 2 + baselineOffset(initialsSize),
    });
  }
  return ops;
}

/** The Lukka Place lockup: roofline over "Lukka Place  lukkaplace.com", bottom-anchored. */
function platformLockup({ x, bottom, nameSize, urlSize, gap, markWidth, markInset, markGap }, measure, hasMark) {
  const rowH = Math.max(lineBox(nameSize), baselineOffset(nameSize) + (lineBox(urlSize) - baselineOffset(urlSize)));
  const rowTop = bottom - rowH;
  const baseline = rowTop + baselineOffset(nameSize);
  const nameW = measure('Lukka Place', { size: nameSize, weight: 800 });
  const ops = [];
  let top = rowTop;
  if (hasMark) {
    const markH = markWidth / 2;
    top = rowTop - markGap - markH;
    ops.push({ type: 'image', key: 'mark', x: x + markInset, y: top, w: markWidth, h: markH, fit: 'contain' });
  }
  ops.push(
    { type: 'text', text: 'Lukka Place', x, y: baseline, size: nameSize, weight: 800, color: COLORS.white, align: 'left' },
    { type: 'text', text: 'lukkaplace.com', x: x + nameW + gap, y: baseline, size: urlSize, weight: 500, color: 'rgba(255,255,255,0.85)', align: 'left' },
  );
  return { ops, top };
}

/**
 * Price, facts, rooms — flowing down from `top`. Returns the ops and the
 * bottom edge so a layout can place what follows.
 */
function listingText(pack, { x, top, width, price, period, periodGap, facts, factsGap, rooms, roomsGap }, measure) {
  const ops = [];
  const amountBaseline = baselineOffset(price.size, 1);
  const periodBaseline = baselineOffset(period.size);
  const rowBaseline = Math.max(amountBaseline, periodBaseline);
  const rowH = Math.max(
    rowBaseline + (lineBox(price.size, 1) - amountBaseline),
    rowBaseline + (lineBox(period.size) - periodBaseline),
  );
  ops.push({ type: 'text', text: pack.amount, x, y: top + rowBaseline, size: price.size, weight: 800, color: COLORS.white, align: 'left' });
  if (pack.period) {
    const amountW = measure(pack.amount, { size: price.size, weight: 800 });
    ops.push({
      type: 'text', text: pack.period, x: x + amountW + periodGap, y: top + rowBaseline,
      size: period.size, weight: 500, color: 'rgba(255,255,255,0.78)', align: 'left',
    });
  }
  let y = top + rowH;

  const block = (text, spec, gap, color) => {
    if (!text) return;
    const lines = wrapText(text, width, { size: spec.size, weight: 500 }, spec.maxLines, measure);
    y += gap;
    const lh = lineBox(spec.size, 1.25);
    lines.forEach((line, i) => {
      ops.push({ type: 'text', text: line, x, y: y + i * lh + baselineOffset(spec.size, 1.25), size: spec.size, weight: 500, color, align: 'left' });
    });
    y += lines.length * lh;
  };
  block(pack.facts, facts, factsGap, COLORS.white);
  block(pack.rooms, rooms, roomsGap, 'rgba(255,255,255,0.8)');
  return { ops, bottom: y };
}

// ---------------------------------------------------------------------------
// Flyer formats
// ---------------------------------------------------------------------------

const GAP = 6;

function squareFlyer(pack, { measure, photoCount, hasLogo, hasMark }) {
  const { width: W, height: H } = FORMATS.square;
  const PHOTO_H = 640;
  const PAD_X = 48;
  const PAD_Y = 38;
  const BRAND_W = 290;
  const top = PHOTO_H + PAD_Y;
  const bottom = H - PAD_Y;
  const brandX = W - PAD_X - BRAND_W;
  const leftW = brandX - 36 - PAD_X;
  const hasBrand = Boolean(hasLogo || pack.agent?.initials);

  const ops = [{ type: 'rect', x: 0, y: 0, w: W, h: H, fill: COLORS.royal }];
  ops.push(...photoGrid({ x: 0, y: 0, w: W, h: PHOTO_H }, photoCount, { mode: 'side', gap: GAP, mainSize: 700, wordmarkSize: 96 }));
  ops.push(...purposePill(pack.purposeLabel, { x: 36, y: 36, size: 30, padX: 26, padY: 12, letterSpacing: 2 }, measure));

  ops.push(
    ...listingText(pack, {
      x: PAD_X, top, width: hasBrand ? leftW : W - PAD_X * 2,
      price: { size: 80 }, period: { size: 34 }, periodGap: 14,
      facts: { size: 31, maxLines: 2 }, factsGap: 18,
      rooms: { size: 26, maxLines: 1 }, roomsGap: 10,
    }, measure).ops,
  );
  ops.push(
    ...platformLockup({ x: PAD_X, bottom, nameSize: 38, urlSize: 25, gap: 14, markWidth: 150, markInset: 35, markGap: 6 }, measure, hasMark).ops,
  );

  if (hasBrand) {
    const cx = brandX + BRAND_W / 2;
    const agent = pack.agent;
    ops.push(...agentCard(agent, { x: cx - 88, y: top, size: 176, radius: 26, pad: 16, initialsSize: 68 }, hasLogo));
    let y = top + 176;
    if (agent.name) {
      const lines = wrapText(agent.name, BRAND_W, { size: 25, weight: 800 }, 2, measure);
      y += 14;
      lines.forEach((line, i) => {
        ops.push({ type: 'text', text: line, x: cx, y: y + i * 30 + baselineOffset(25, 1.2), size: 25, weight: 800, color: COLORS.white, align: 'center' });
      });
      y += lines.length * 30;
    }
    if (agent.badge) {
      const badge = goldBadge(agent.badge, { size: 21, padX: 16, padY: 7, iconSize: 20, gap: 8 }, measure);
      y += 10;
      ops.push(...badge.at(cx - badge.w / 2, y));
      y += badge.h;
    }
    if (agent.phone) {
      const row = phoneRow(agent.phone, { size: 24, iconSize: 26, gap: 9, weight: 800 }, measure);
      y += 12;
      ops.push(...row.at(cx - row.w / 2, y));
    }
  }
  return { width: W, height: H, ops };
}

/**
 * 9:16 for WhatsApp Status / Reels / TikTok. Status draws its own chrome over
 * the top ~150px (progress bar, name) and the bottom ~160px (reply bar), so
 * the purpose pill sits below the first and the lockup ends above the second.
 */
function storyFlyer(pack, { measure, photoCount, hasLogo, hasMark }) {
  const { width: W, height: H } = FORMATS.story;
  const PHOTO_H = 1040;
  const PAD_X = 56;
  const SAFE_BOTTOM = 170;

  const ops = [{ type: 'rect', x: 0, y: 0, w: W, h: H, fill: COLORS.royal }];
  ops.push(...photoGrid({ x: 0, y: 0, w: W, h: PHOTO_H }, photoCount, { mode: 'below', gap: GAP, mainSize: 700, wordmarkSize: 120 }));
  ops.push(...purposePill(pack.purposeLabel, { x: PAD_X, y: 180, size: 34, padX: 30, padY: 14, letterSpacing: 2 }, measure));

  const text = listingText(pack, {
    x: PAD_X, top: PHOTO_H + 60, width: W - PAD_X * 2,
    price: { size: 104 }, period: { size: 42 }, periodGap: 18,
    facts: { size: 38, maxLines: 2 }, factsGap: 22,
    rooms: { size: 32, maxLines: 1 }, roomsGap: 12,
  }, measure);
  ops.push(...text.ops);

  let flowBottom = text.bottom;
  if (hasLogo || pack.agent?.initials) {
    const agent = pack.agent;
    const cardTop = text.bottom + 44;
    const CARD = 150;
    ops.push(...agentCard(agent, { x: PAD_X, y: cardTop, size: CARD, radius: 24, pad: 14, initialsSize: 58 }, hasLogo));

    const colX = PAD_X + CARD + 32;
    const colW = W - PAD_X - colX;
    const items = [];
    if (agent.name) {
      const lines = wrapText(agent.name, colW, { size: 36, weight: 800 }, 2, measure);
      items.push({
        h: lines.length * 43, gap: 0,
        draw: (y) => lines.map((line, i) => ({ type: 'text', text: line, x: colX, y: y + i * 43 + baselineOffset(36, 1.2), size: 36, weight: 800, color: COLORS.white, align: 'left' })),
      });
    }
    if (agent.badge) {
      const badge = goldBadge(agent.badge, { size: 26, padX: 18, padY: 8, iconSize: 24, gap: 10 }, measure);
      items.push({ h: badge.h, gap: 12, draw: (y) => badge.at(colX, y) });
    }
    if (agent.phone) {
      const row = phoneRow(agent.phone, { size: 30, iconSize: 32, gap: 12, weight: 800 }, measure);
      items.push({ h: row.h, gap: 14, draw: (y) => row.at(colX, y) });
    }
    const colH = items.reduce((sum, item, i) => sum + item.h + (i ? item.gap : 0), 0);
    let y = cardTop + Math.max(0, (CARD - colH) / 2);
    items.forEach((item, i) => {
      if (i) y += item.gap;
      ops.push(...item.draw(y));
      y += item.h;
    });
    flowBottom = cardTop + Math.max(CARD, colH);
  }

  const lockupBottom = Math.max(H - SAFE_BOTTOM, flowBottom + 48 + 81 + lineBox(44));
  ops.push(
    ...platformLockup({ x: PAD_X, bottom: Math.min(lockupBottom, H - 40), nameSize: 44, urlSize: 29, gap: 16, markWidth: 150, markInset: 55, markGap: 6 }, measure, hasMark).ops,
  );
  return { width: W, height: H, ops };
}

/** 16:9 for Facebook link posts, X and LinkedIn: photos left, text panel right. */
function landscapeFlyer(pack, { measure, photoCount, hasLogo, hasMark }) {
  const { width: W, height: H } = FORMATS.landscape;
  const PHOTO_W = 720;
  const PAD = 40;
  const x = PHOTO_W + PAD;
  const width = W - x - PAD;

  const ops = [{ type: 'rect', x: 0, y: 0, w: W, h: H, fill: COLORS.royal }];
  ops.push(...photoGrid({ x: 0, y: 0, w: PHOTO_W, h: H }, photoCount, { mode: 'below', gap: GAP, mainSize: 440, wordmarkSize: 64 }));
  ops.push(...purposePill(pack.purposeLabel, { x: 28, y: 28, size: 24, padX: 20, padY: 9, letterSpacing: 2 }, measure));

  const text = listingText(pack, {
    x, top: PAD, width,
    price: { size: 64 }, period: { size: 26 }, periodGap: 12,
    facts: { size: 24, maxLines: 2 }, factsGap: 14,
    rooms: { size: 21, maxLines: 1 }, roomsGap: 8,
  }, measure);
  ops.push(...text.ops);

  if (hasLogo || pack.agent?.initials) {
    const agent = pack.agent;
    const CARD = 96;
    const cardTop = text.bottom + 28;
    ops.push(...agentCard(agent, { x, y: cardTop, size: CARD, radius: 16, pad: 10, initialsSize: 38 }, hasLogo));
    const colX = x + CARD + 18;
    const colW = W - PAD - colX;
    let y = cardTop;
    if (agent.name) {
      const [line] = wrapText(agent.name, colW, { size: 22, weight: 800 }, 1, measure);
      ops.push({ type: 'text', text: line, x: colX, y: y + baselineOffset(22, 1.2), size: 22, weight: 800, color: COLORS.white, align: 'left' });
      y += 26.4;
    }
    if (agent.badge) {
      const badge = goldBadge(agent.badge, { size: 16, padX: 12, padY: 5, iconSize: 15, gap: 6 }, measure);
      y += 8;
      ops.push(...badge.at(colX, y));
      y += badge.h;
    }
    if (agent.phone) {
      const row = phoneRow(agent.phone, { size: 19, iconSize: 21, gap: 8, weight: 800 }, measure);
      y += 8;
      ops.push(...row.at(colX, y));
    }
  }

  ops.push(
    ...platformLockup({ x, bottom: H - 36, nameSize: 30, urlSize: 20, gap: 12, markWidth: 110, markInset: 26, markGap: 5 }, measure, hasMark).ops,
  );
  return { width: W, height: H, ops };
}

const FLYERS = { square: squareFlyer, story: storyFlyer, landscape: landscapeFlyer };

/**
 * @param {object} pack  See lib/marketing/sharePackData.js buildFlyerPack.
 * @param {'square'|'story'|'landscape'} formatKey
 * @param {{measure: Function, photoCount: number, hasLogo: boolean, hasMark: boolean}} env
 */
export function buildFlyerOps(pack, formatKey, env) {
  const flyer = FLYERS[formatKey];
  if (!flyer) throw new Error(`unknown flyer format: ${formatKey}`);
  return flyer(pack, {
    ...env,
    photoCount: Math.max(0, Math.min(3, env.photoCount || 0)),
    hasLogo: Boolean(env.hasLogo),
    hasMark: Boolean(env.hasMark),
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
