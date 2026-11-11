/**
 * The 3 + 1 + 1 guide (2026-11-11): its calculator (lib/depositCalc.js,
 * components/blog/DepositCalculator.js), the `:::calculateur` block, the
 * English version of a code guide, and the three removed guides' redirects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALCULATOR_LABEL_KEYS, DEPOSIT_PRESETS, LEGAL_MAX, clampMonths, moveInCost } from '@/lib/depositCalc';
import { GUIDES, REMOVED_GUIDE_SLUGS, getGuide } from '@/lib/guides';
import { articleFromGuide, bodyProblems, mergeArticles, parseBody, readingMinutes } from '@/lib/blogRules';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import en from '@/lib/i18n/en.json' with { type: 'json' };

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '../..');
const read = (rel) => readFileSync(path.join(web, rel), 'utf8');

test('3 + 1 + 1 on 670 $: 3 350 $ on entry, 2 010 $ of it refundable, within the law', () => {
  const r = moveInCost({ rent: 670, deposit: 3, advance: 1, commission: 1 });
  assert.equal(r.askedTotal, 3350);
  assert.equal(r.refundable, 2010);
  assert.equal(r.legalTotal, 3350);
  assert.equal(r.excess, 0);
  assert.deepEqual(r.over, { deposit: false, extraAdvance: false, commission: false });
});

test('10 + 2 + 1 on 1 450 $: 18 850 $ asked against a 7 250 $ legal ceiling', () => {
  const r = moveInCost({ rent: 1450, deposit: 10, advance: 2, commission: 1 });
  assert.equal(r.askedTotal, 18850);
  assert.equal(r.legalTotal, 7250);
  assert.equal(r.excess, 11600);
  assert.equal(r.excessMonths, 8);
  assert.equal(r.asked.firstMonth, 1450, 'the first month is rent, not advance');
  assert.equal(r.asked.extraAdvance, 1450);
  assert.equal(r.legal.extraAdvance, 0, 'art. 22: no rent in advance');
  assert.equal(r.legal.deposit, LEGAL_MAX.deposit * 1450, 'art. 18: 3 months');
});

test('the three costs are never merged, and the law never raises what is asked', () => {
  for (const [g, a, c] of [...DEPOSIT_PRESETS, [0, 0, 0], [2, 0, 0.5], [24, 12, 3]]) {
    const r = moveInCost({ rent: 500, deposit: g, advance: a, commission: c });
    assert.equal(r.askedTotal, r.asked.deposit + r.asked.firstMonth + r.asked.extraAdvance + r.asked.commission);
    assert.ok(r.legalTotal <= r.askedTotal);
    assert.ok(r.legal.commission <= 500, 'art. 10: one month at most');
  }
});

test('no rent, no result; months are clamped and snapped', () => {
  assert.equal(moveInCost({ rent: 0, deposit: 3, advance: 1, commission: 1 }), null);
  assert.equal(moveInCost({ rent: 'abc', deposit: 3, advance: 1, commission: 1 }), null);
  assert.equal(clampMonths('deposit', 99), 24);
  assert.equal(clampMonths('deposit', -2), 0);
  assert.equal(clampMonths('commission', 0.7), 0.5);
  assert.equal(clampMonths('advance', Number.NaN), 0);
});

test('every calculator label exists in both languages', () => {
  for (const key of CALCULATOR_LABEL_KEYS) {
    assert.ok(fr.guides.calculator[key], `fr ${key}`);
    assert.ok(en.guides.calculator[key], `en ${key}`);
  }
  assert.deepEqual(Object.keys(fr.guides.calculator).sort(), [...CALCULATOR_LABEL_KEYS].sort());
});

test(':::calculateur is a one-line block; an unknown type is refused by name', () => {
  assert.deepEqual(parseBody(':::calculateur'), [{ calculator: { kind: 'garantie' } }]);
  assert.deepEqual(parseBody(':::calculateur type=garantie\n:::'), [{ calculator: { kind: 'garantie' } }]);
  assert.ok(parseBody(':::calculateur type=hypotheque')[0].invalid);
  assert.deepEqual(bodyProblems('Texte\n\n:::calculateur'), []);
  assert.match(read('components/blog/ArticleBody.js'), /block\.calculator\) return <LiveDepositCalculator/);
});

test('one guide is left: the 3 + 1 + 1 article, with its calculator, in French and English', () => {
  assert.deepEqual(GUIDES.map((g) => g.slug), ['garantie-3-1-1-kinshasa']);
  const guide = getGuide('garantie-3-1-1-kinshasa');
  assert.ok(guide.body.some((b) => b.calculator));
  assert.ok(guide.en.body.some((b) => b.calculator));
  const frArticle = articleFromGuide(guide, 'fr');
  const enArticle = articleFromGuide(guide, 'en');
  assert.equal(frArticle.category, 'guide');
  assert.equal(frArticle.lang, 'fr');
  assert.equal(enArticle.lang, 'en');
  assert.equal(enArticle.title, guide.en.title);
  assert.equal(enArticle.cta.href, '/location');
  assert.equal(mergeArticles(GUIDES, [], 'en')[0].lang, 'en');
  assert.ok(readingMinutes(guide.body) >= 3);
  assert.equal(guide.en.body.length, guide.body.length, 'the two versions keep the same structure');
});

test('the removed guides redirect to /guides', () => {
  const config = read('next.config.mjs');
  for (const slug of REMOVED_GUIDE_SLUGS) {
    assert.equal(getGuide(slug), null);
    assert.ok(config.includes(slug), `${slug} redirect`);
  }
  assert.match(config, /destination: '\/guides',\s*permanent: true/);
});
