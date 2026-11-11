/**
 * Axis ticks for a chart (components/blog/SeriesChart.js), pure so the unit
 * tier can test it (it cannot load JSX).
 */

/** Round ticks covering [min, max]: a step of 1, 2, 2.5 or 5 × a power of ten, never below 0. */
export function niceTicks(min, max, target = 3) {
  if (!(Number.isFinite(min) && Number.isFinite(max))) return [];
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.1);
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((m) => m >= raw);
  const lo = Math.max(0, Math.floor(min / step) * step);
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}
