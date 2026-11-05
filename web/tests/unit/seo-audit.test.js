import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  TARGET_SEARCHES, communeCoverage, countForFacet, coverageSummary, matchTargetRows, pathForFacet,
  percentOf, queryTokens, resultsPage,
} from '@/lib/seoAuditRules';
import { buildServiceAccountJwt, dateRange, readServiceAccount } from '@/lib/searchConsole';
import { sameAsProfiles } from '@/lib/seoSchema';
import { ADMIN_NAV_HREFS } from '@/lib/adminNav';
import { sectionPermission } from '@/lib/adminRoles';

/** /admin/seo — lib/seoAuditRules.js, lib/searchConsole.js, sameAs. */

const FACETS = [
  { commune: 'Gombe', purpose: 'rent', propertyType: 'appartement', count: 13 },
  { commune: 'Gombe', purpose: 'rent', propertyType: 'maison', count: 2 },
  { commune: 'Gombe', purpose: 'rent', propertyType: 'parcelle', count: 2 }, // overlay: re-counts the maisons
  { commune: 'Limete', purpose: 'sale', propertyType: 'terrain', count: 4 },
  { commune: null, purpose: 'rent', propertyType: 'appartement', count: 3 },
  { commune: 'Kampemba', purpose: 'rent', propertyType: 'appartement', count: 9 }, // Lubumbashi
];

test('every target search has a French landing page', () => {
  for (const target of TARGET_SEARCHES) {
    const path = pathForFacet(target.facet);
    assert.match(path, /^\/(location|vente)?/, target.query);
  }
  assert.equal(pathForFacet({ purpose: 'rent', propertyType: 'appartement', commune: 'Gombe' }), '/location/appartements/gombe');
  assert.equal(pathForFacet({ purpose: 'sale', propertyType: 'terrain' }), '/vente/terrains');
  assert.equal(pathForFacet({}), '/');
  assert.ok(TARGET_SEARCHES.some((t) => t.lang === 'en') && TARGET_SEARCHES.some((t) => t.lang === 'fr'));
});

test('counts follow the landing page: Kinshasa only, overlays only on their own page', () => {
  assert.equal(countForFacet(FACETS, { purpose: 'rent', propertyType: 'appartement' }), 16); // not Kampemba
  assert.equal(countForFacet(FACETS, { purpose: 'rent', commune: 'Gombe' }), 15); // parcelle not added twice
  assert.equal(countForFacet(FACETS, { purpose: 'rent', propertyType: 'parcelle' }), 2);
});

test('commune coverage covers all 24 communes and flags empty and thin pages', () => {
  const rows = communeCoverage(FACETS);
  assert.equal(rows.length, 24);
  assert.equal(rows[0].commune, 'Gombe');
  assert.deepEqual(rows.find((r) => r.commune === 'Limete'), {
    commune: 'Limete', rent: 0, sale: 4, rentPath: '/location/limete', salePath: '/vente/limete',
  });
  const summary = coverageSummary(rows);
  assert.equal(summary.indexable, 2);
  assert.equal(summary.thin, 1); // Limete sale (4)
  assert.equal(summary.empty, 46);
});

test('a Search Console query matches a target in either language spelling', () => {
  assert.deepEqual([...queryTokens('Apartments for rent in Kinshasa')].sort(), ['appartement', 'kinshasa', 'louer']);
  assert.deepEqual([...queryTokens('appartement à louer kinshasa')].sort(), ['appartement', 'kinshasa', 'louer']);
  const rows = [
    { keys: ['location appartement kinshasa gombe'], clicks: 2, impressions: 100, position: 8 },
    { keys: ['appartements à louer à kinshasa'], clicks: 1, impressions: 300, position: 12 },
    { keys: ['maison à vendre kinshasa'], clicks: 5, impressions: 50, position: 3 },
  ];
  const match = matchTargetRows('appartement à louer kinshasa', rows);
  assert.equal(match.queries, 2);
  assert.equal(match.clicks, 3);
  assert.equal(match.impressions, 400);
  assert.equal(match.position, 11); // (8×100 + 12×300) / 400
  assert.equal(matchTargetRows('land for sale kinshasa', rows), null);
  assert.equal(resultsPage(11), 2);
  assert.equal(resultsPage(9.6), 1);
  assert.equal(resultsPage(null), null);
  assert.equal(percentOf(1, 3), 33);
  assert.equal(percentOf(0, 0), 0);
});

test('the service-account JWT is a valid RS256 assertion for the read-only scope', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const raw = JSON.stringify({ client_email: 'seo@proj.iam.gserviceaccount.com', private_key: pem });
  const account = readServiceAccount(raw);
  assert.deepEqual(readServiceAccount(Buffer.from(raw).toString('base64')), account);
  assert.equal(readServiceAccount(''), null);
  assert.equal(readServiceAccount('{"client_email":"x"}'), null);

  const jwt = buildServiceAccountJwt(account, 1_800_000_000);
  const [header, claims, signature] = jwt.split('.');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${header}.${claims}`);
  assert.ok(verifier.verify(publicKey, Buffer.from(signature, 'base64url')));
  const body = JSON.parse(Buffer.from(claims, 'base64url').toString());
  assert.equal(body.scope, 'https://www.googleapis.com/auth/webmasters.readonly');
  assert.equal(body.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(body.exp - body.iat, 3600);
  assert.deepEqual(dateRange(28, new Date('2026-11-05T12:00:00Z')), { startDate: '2026-10-09', endDate: '2026-11-05' });
});

test('sameAs takes the saved profiles, without tracking parameters or WhatsApp', () => {
  assert.deepEqual(sameAsProfiles({
    instagram: 'https://www.instagram.com/lukkaplace?obrf=OWV6&utm_source=qr',
    tiktok: 'https://www.tiktok.com/@lukka.place?_r=1&_t=ZS-9',
    whatsapp: 'https://wa.me/243976321848',
    facebook: 'javascript:alert(1)',
  }), ['https://www.instagram.com/lukkaplace', 'https://www.tiktok.com/@lukka.place']);
  const home = readFileSync(new URL('../../app/(site)/(home)/page.js', import.meta.url), 'utf8');
  assert.match(home, /organizationSchema\(\{ profiles \}\)/);
});

test('/admin/seo is in the console nav and needs market.view', () => {
  assert.ok(ADMIN_NAV_HREFS.includes('/admin/seo'));
  assert.equal(sectionPermission('/admin/seo'), 'market.view');
});
