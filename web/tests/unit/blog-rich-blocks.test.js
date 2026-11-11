/**
 * Rich blocks in posts (2026-11-10): tables, key figures, charts, callouts,
 * quotes, live prices and live listings — lib/blogRules.js parseBody /
 * bodyProblems, components/blog/*, scripts/blog-import.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bodyProblems, canonicalCommune, parseBody, parseFigure, readingMinutes, validatePostInput } from '@/lib/blogRules';
import { parseArticleFile } from '../../scripts/blog-import.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '../..');
const read = (rel) => readFileSync(path.join(web, rel), 'utf8');

test('tables: a |---| line makes the header; cells keep safe links', () => {
  const [block] = parseBody('| Commune | Loyer |\n|---|---|\n| [Gombe](/location/gombe) | 1 200 $ |\n| Limete | 450 $ |');
  assert.deepEqual(block.table.head, ['Commune', 'Loyer']);
  assert.equal(block.table.rows.length, 2);
  assert.equal(block.table.rows[0][0][0].href, '/location/gombe');
  const [noHead] = parseBody('| a | b |\n| c |');
  assert.equal(noHead.table.head, null);
  assert.deepEqual(noHead.table.rows[1], ['c', ''], 'short rows are padded');
});

test('directives: figures, charts, callouts, quotes, live prices and listings', () => {
  const blocks = parseBody([
    ':::chiffres source="Guide des prix"',
    '450 $ | Loyer médian',
    ':::',
    ':::graphique type=ligne titre="Évolution" unite="$" source="Lukka Place" series="2025, 2026"',
    'Gombe | 1 000 | 1 200',
    'Limete | 400 | 450',
    ':::',
    ':::attention',
    'Ne payez rien avant la visite.',
    '- jamais en avance',
    ':::',
    ':::citation auteur="Un agent" role="Gombe"',
    'Le marché bouge vite.',
    ':::',
    ':::prix communes="gombe, NGALIEMA" chambres=2',
    ':::annonces commune=limete type=appartement',
  ].join('\n'));
  assert.deepEqual(blocks[0].stats, { items: [{ value: '450 $', label: 'Loyer médian' }], source: 'Guide des prix' });
  assert.equal(blocks[1].chart.kind, 'line');
  assert.deepEqual(blocks[1].chart.points[0], { label: 'Gombe', values: [1000, 1200] });
  assert.deepEqual(blocks[1].chart.series, ['2025', '2026']);
  assert.equal(blocks[2].callout.tone, 'warning');
  assert.deepEqual(blocks[2].callout.blocks, [{ p: 'Ne payez rien avant la visite.' }, { ul: ['jamais en avance'] }]);
  assert.deepEqual(blocks[3].quote, { text: 'Le marché bouge vite.', author: 'Un agent', role: 'Gombe' });
  assert.deepEqual(blocks[4].prices, { communes: ['Gombe', 'Ngaliema'], beds: 2 });
  assert.deepEqual(blocks[5].listings, { commune: 'Limete', propertyType: 'appartement', transaction: 'location' });
  assert.deepEqual(bodyProblems(blocks.map(() => '').join('')), []);
});

test('never invent: a chart needs a source; unknown communes and bad lines are refused, not guessed', () => {
  const cases = {
    ':::graphique\nA | 1\nB | 2\n:::': /source/,
    ':::graphique source="x"\nA | beaucoup\nB | 2\n:::': /illisible/,
    ':::graphique source="x"\nA | 1 | 2\nB | 2 | 3\n:::': /nommer les séries/,
    ':::prix communes="Atlantis"': /commune inconnue : Atlantis/,
    ':::prix communes="Gombe, Limete"': /chambres=/,
    ':::annonces type=chateau': /type inconnu/,
    ':::chiffres\n1 | a\n2 | b\n3 | c\n4 | d\n5 | e\n:::': /entre 1 et 4/,
    ':::astuce\njamais fermé': /jamais fermé/,
    ':::inventé\nx\n:::': /bloc inconnu/,
  };
  for (const [body, reason] of Object.entries(cases)) {
    const problems = bodyProblems(body);
    assert.equal(problems.length, 1, body);
    assert.match(problems[0], reason, body);
  }
  assert.equal(canonicalCommune('ngaliema'), 'Ngaliema');
  assert.equal(canonicalCommune('Nowhere'), null);
});

test('figures read French notation', () => {
  assert.equal(parseFigure('1 200 $'), 1200);
  assert.equal(parseFigure('1 200'), 1200);
  assert.equal(parseFigure('2,5'), 2.5);
  assert.equal(parseFigure('-3 %'), -3);
  assert.equal(parseFigure('n/a'), null);
});

test('saving refuses a body with an unreadable block and names it', () => {
  const r = validatePostInput({ title_fr: 'T', body_fr: 'Texte\n\n:::graphique\nA | 1\nB | 2\n:::', category: 'guide', status: 'draft' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'badBlock');
  assert.match(r.detail, /:::graphique — un graphique a toujours une source/);
  const en = validatePostInput({ title_fr: 'T', body_fr: 'ok', title_en: 'T', body_en: ':::nope\n:::', category: 'guide', status: 'draft' });
  assert.equal(en.field, 'body_en');
  assert.match(read('app/admin/blog/actions.js'), /check\.detail/);
});

test('reading time counts the words in tables and callouts', () => {
  const words = Array(400).fill('mot').join(' ');
  assert.equal(readingMinutes(parseBody(`:::info\n${words}\n:::`)), 2);
  assert.equal(readingMinutes(parseBody(`| ${words} |`)), 2);
});

test('import file: header, French body, optional English after the marker', () => {
  const file = parseArticleFile('﻿---\r\ntitre: "Louer à Gombe"\r\ncategorie: guide\r\ncommune: Gombe\r\n---\r\n## Un\r\n\r\nTexte\r\n=== english ===\r\n## One\r\n');
  assert.deepEqual(file.fields, { title_fr: 'Louer à Gombe', category: 'guide', commune: 'Gombe' });
  assert.equal(file.body_fr, '## Un\n\nTexte');
  assert.equal(file.body_en, '## One');
  assert.throws(() => parseArticleFile('pas d’en-tête'), /en-tête/);
  assert.throws(() => parseArticleFile('---\nauteur: X\n---\n'), /clé d’en-tête inconnue/);
});

test('import never publishes: new posts are drafts, the console publishes', () => {
  const src = read('scripts/blog-import.mjs');
  assert.match(src, /status: existing \? existing\.status : 'draft'/);
  assert.match(src, /if \(!write\)/);
  assert.match(src, /script:blog-import/);
});

test('rendering: no HTML path, motion only without reduced-motion, live blocks fail soft', () => {
  for (const f of ['components/blog/ArticleBody.js', 'components/blog/BlogChart.js', 'components/blog/LiveBlocks.js', 'components/blog/LiveListings.js']) {
    assert.doesNotMatch(read(f), /dangerouslySetInnerHTML/, f);
  }
  const css = read('app/globals.css');
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*\[data-reveal='armed'\]/);
  assert.match(read('components/blog/Reveal.js'), /dataset\.reveal = 'armed'/);
  assert.match(read('components/blog/CountUp.js'), /prefers-reduced-motion: reduce/);
  assert.match(read('components/blog/LiveBlocks.js'), /pricesMissing/);
  assert.match(read('components/blog/LiveListings.js'), /if \(!listings\.length\) return null/);
  // The console preview never imports the storefront cards; only the public page passes them.
  assert.doesNotMatch(read('components/blog/ArticleBody.js'), /^import .*(LiveListings|PropertyCard)/m);
  assert.match(read('app/(site)/guides/[slug]/page.js'), /listingsBlock=\{LiveListings\}/);
});
