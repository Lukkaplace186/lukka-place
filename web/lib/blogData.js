import 'server-only';
import { getMarketSeries } from './marketSnapshots';
import { getLukkaIndex, getPriceGuides } from './browseFeatures';

/**
 * The figures behind a post's live data blocks ({data} blocks, grammar in
 * lib/blogRules.js parseDataBlock), read when the page is rendered — a post
 * never stores a number. Each block gets `result`:
 *
 *  - indice + commune → `{ series: [{ month, median, sample }] }` oldest first,
 *    from market_snapshots_monthly via getMarketSeries (median null below
 *    MIN_SAMPLE asks: the month keeps its count, the page prints "—").
 *  - indice alone     → `{ index }`, getLukkaIndex() — the /indice-lukka table.
 *  - prix             → `{ guides: [...] }`, getPriceGuides() filtered to the
 *    commune (and bedrooms) — the /combien-coute rows, blended and de-duplicated
 *    there, MIN_PRICE_SAMPLE listings each.
 *
 * Reads never throw: a failure is `{ unavailable: true }` and the block says
 * the figures cannot be shown right now. Each source is read once per page.
 */
export async function resolveDataBlocks(blocks, loaders = { getMarketSeries, getLukkaIndex, getPriceGuides }) {
  if (!(blocks || []).some((b) => b.data && !b.data.error)) return blocks || [];
  let indexPromise = null;
  let guidesPromise = null;
  const index = () => (indexPromise ??= loaders.getLukkaIndex());
  const guides = () => (guidesPromise ??= loaders.getPriceGuides());

  return Promise.all(
    blocks.map(async (block) => {
      const spec = block.data;
      if (!spec || spec.error) return block;
      try {
        if (spec.kind === 'prix') {
          const rows = (await guides()).filter((g) => g.commune === spec.commune && (spec.beds == null || g.beds === spec.beds));
          return { data: { ...spec, result: { guides: rows.sort((a, b) => a.beds - b.beds) } } };
        }
        if (!spec.commune) return { data: { ...spec, result: { index: await index() } } };
        const { rows, available } = await loaders.getMarketSeries({ commune: spec.commune, purpose: spec.purpose, months: spec.months });
        if (!available) return { data: { ...spec, result: { unavailable: true } } };
        const series = rows
          .map((row) => ({ month: row.month, median: row.medianAsk, sample: row.askSample }))
          .reverse();
        return { data: { ...spec, result: { series } } };
      } catch (err) {
        console.error(`[blog] data block ${spec.kind} ${spec.commune || ''} unavailable: ${err.message}`);
        return { data: { ...spec, result: { unavailable: true } } };
      }
    }),
  );
}
