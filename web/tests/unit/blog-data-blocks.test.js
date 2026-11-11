import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DATA_DEFAULT_MONTHS,
  firstDataBlockError,
  parseBody,
  parseDataBlock,
  readingMinutes,
  resolveCommuneKey,
  validatePostInput,
} from '@/lib/blogRules';
import { resolveDataBlocks } from '@/lib/blogData';
import { niceTicks } from '@/lib/niceTicks';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '../..', rel), 'utf8');

test('data blocks: grammar, defaults and French option words', () => {
  assert.equal(parseDataBlock('Un paragraphe {{indice}} au milieu'), null);
  assert.deepEqual(parseDataBlock('{{indice}}'), { kind: 'indice', commune: null, months: DATA_DEFAULT_MONTHS, purpose: 'rent', view: 'table' });
  assert.deepEqual(parseDataBlock('{{ indice commune=gombe mois=12 affichage=graphique offre=vente }}'), {
    kind: 'indice', commune: 'Gombe', months: 12, purpose: 'sale', view: 'chart',
  });
  assert.deepEqual(parseDataBlock('{{indice commune="Mont Ngafula"}}').commune, 'Mont-Ngafula');
  assert.deepEqual(parseDataBlock('{{prix commune=Limete chambres=2}}'), { kind: 'prix', commune: 'Limete', beds: 2 });
  assert.deepEqual(parseDataBlock('{{prix commune=Limete}}'), { kind: 'prix', commune: 'Limete', beds: null });
});

test('data blocks: every unreadable block names its reason, never a guess', () => {
  const reason = (line) => parseDataBlock(line)?.error;
  assert.equal(reason('{{graphique}}'), 'unknownKind');
  assert.equal(reason('{{indice commune}}'), 'badSyntax');
  assert.equal(reason('{{indice ville=Gombe}}'), 'unknownOption');
  assert.equal(reason('{{indice commune=Gombe commune=Lemba}}'), 'unknownOption');
  assert.equal(reason('{{prix commune=Gombe mois=3}}'), 'unknownOption');
  assert.equal(reason('{{indice commune=Atlantis}}'), 'badCommune');
  assert.equal(reason('{{prix}}'), 'communeRequired');
  assert.equal(reason('{{prix commune=Gombe chambres=6}}'), 'badBeds');
  assert.equal(reason('{{indice commune=Gombe mois=1}}'), 'badMonths');
  assert.equal(reason('{{indice commune=Gombe mois=25}}'), 'badMonths');
  assert.equal(reason('{{indice commune=Gombe offre=achat}}'), 'badPurpose');
  assert.equal(reason('{{indice commune=Gombe affichage=camembert}}'), 'badView');
  assert.equal(reason('{{indice offre=vente}}'), 'saleNeedsCommune');
  assert.equal(reason('{{indice affichage=graphique}}'), 'chartNeedsCommune');
});

test('communes: exact key, Kinshasa first for a shared label, refused when ambiguous', () => {
  assert.equal(resolveCommuneKey('kasa vubu'), 'Kasa-Vubu');
  assert.equal(resolveCommuneKey('Kalamu'), 'Kalamu');
  assert.equal(resolveCommuneKey('Kalamu (Boma)'), 'Kalamu (Boma)');
  // Kabondo is a commune of Kisangani AND of Boma, none in Kinshasa.
  assert.equal(resolveCommuneKey('Kabondo'), null);
  assert.equal(resolveCommuneKey(''), null);
});

test('body: a data block is its own block, between paragraphs, and adds no reading time', () => {
  const blocks = parseBody('Avant.\n{{indice commune=Gombe}}\nAprès.\n\n- un\n{{prix commune=Gombe}}');
  assert.deepEqual(blocks.map((b) => Object.keys(b)[0]), ['p', 'data', 'p', 'ul', 'data']);
  assert.equal(readingMinutes(blocks), 1);
});

test('validation: a post with an unreadable data block is refused, in either language', () => {
  const base = { title_fr: 'Titre', body_fr: 'Texte', category: 'actualite' };
  assert.equal(validatePostInput({ ...base, body_fr: 'Texte\n\n{{indice commune=Gombe}}' }).ok, true);
  const fr = validatePostInput({ ...base, body_fr: 'Texte\n{{indice commune=Atlantis}}' });
  assert.deepEqual([fr.ok, fr.error, fr.field, fr.reason, fr.line], [false, 'badEmbed', 'body_fr', 'badCommune', '{{indice commune=Atlantis}}']);
  const en = validatePostInput({ ...base, title_en: 'Title', body_en: '{{prix}}' });
  assert.deepEqual([en.error, en.field, en.reason], ['badEmbed', 'body_en', 'communeRequired']);
  assert.equal(firstDataBlockError('rien'), null);
});

test('figures: read at render, each source once, honest when missing or failing', async () => {
  const calls = { series: [], index: 0, guides: 0 };
  const loaders = {
    getMarketSeries: async (args) => {
      calls.series.push(args);
      if (args.commune === 'Lemba') return { rows: [], available: false };
      if (args.commune === 'Ngaba') throw new Error('boom');
      return {
        available: true,
        rows: [
          { month: '2026-10', medianAsk: 900, askSample: 7 },
          { month: '2026-09', medianAsk: null, askSample: 3 },
        ],
      };
    },
    getLukkaIndex: async () => { calls.index += 1; return { month: '2026-10-01', communes: [] }; },
    getPriceGuides: async () => {
      calls.guides += 1;
      return [
        { commune: 'Gombe', beds: 3, median: 2000 },
        { commune: 'Gombe', beds: 1, median: 800 },
        { commune: 'Limete', beds: 2, median: 500 },
      ];
    },
  };
  const blocks = parseBody([
    '{{indice commune=Gombe mois=2 offre=vente}}',
    '{{indice}}', '{{indice}}',
    '{{prix commune=Gombe}}', '{{prix commune=Gombe chambres=3}}',
    '{{indice commune=Lemba}}', '{{indice commune=Ngaba}}',
    '{{inconnu}}', 'Texte',
  ].join('\n\n'));
  const out = await resolveDataBlocks(blocks, loaders);
  assert.deepEqual(calls.series[0], { commune: 'Gombe', purpose: 'sale', months: 2 });
  assert.equal(calls.index, 1);
  assert.equal(calls.guides, 1);
  // Oldest first for a chart; a suppressed month stays, with its count.
  assert.deepEqual(out[0].data.result.series, [
    { month: '2026-09', median: null, sample: 3 },
    { month: '2026-10', median: 900, sample: 7 },
  ]);
  assert.deepEqual(out[3].data.result.guides.map((g) => g.beds), [1, 3]);
  assert.deepEqual(out[4].data.result.guides.map((g) => g.beds), [3]);
  assert.deepEqual(out[5].data.result, { unavailable: true });
  assert.deepEqual(out[6].data.result, { unavailable: true });
  assert.equal(out[7].data.error, 'unknownKind');
  assert.equal(out[7].data.result, undefined);
  assert.deepEqual(out[8], { p: 'Texte' });
  // No data block: nothing is read.
  const plain = parseBody('Juste du texte.');
  assert.equal(await resolveDataBlocks(plain, loaders), plain);
});

test('pages: the article and the preview resolve figures; the renderer stays server-only and text-only', () => {
  assert.match(read('app/(site)/guides/[slug]/page.js'), /resolveDataBlocks\(article\.blocks\)/);
  const preview = read('app/admin/blog/[id]/apercu/page.js');
  assert.match(preview, /resolveDataBlocks\(article\.blocks\)/);
  assert.match(preview, /<ArticleBody blocks=\{blocks\} preview \/>/);
  const block = read('components/blog/DataBlock.js');
  assert.doesNotMatch(block, /'use client'|dangerouslySetInnerHTML/);
  assert.match(read('lib/blogData.js'), /^import 'server-only';/);
  assert.match(read('app/admin/blog/actions.js'), /admin\.blog\.embedErrors\.\$\{check\.reason\}/);
});

test('chart ticks: round steps that contain every value', () => {
  assert.deepEqual(niceTicks(1200, 1400), [1200, 1300, 1400]);
  assert.deepEqual(niceTicks(830, 1170), [800, 1000, 1200]);
  const flat = niceTicks(500, 500);
  assert.ok(flat[0] < 500 && flat.at(-1) > 500);
});
