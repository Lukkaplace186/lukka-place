import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { leadWhatsAppLink } from '@/lib/leadContact';
import { rankAlternatives } from '@/lib/listingAlternatives';

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const text = (href) => decodeURIComponent(new URL(href).searchParams.get('text'));

const live = { id: '286', title: '2 chambres — Appartement à louer à Limete', approve_status: 1, listing_status: 'active', status: 1 };

test('Répondre sur WhatsApp: French, names and links the live listing, from the stored number', () => {
  const href = leadWhatsAppLink({ wa_id: '447932673460', name: 'Mimbo Kasongo', property_id: 286 }, [live]);
  assert.match(href, /^https:\/\/wa\.me\/447932673460\?text=/);
  const body = text(href);
  assert.match(body, /^Bonjour Mimbo,/);
  assert.match(body, /au sujet de : 2 chambres — Appartement à louer à Limete\./);
  assert.match(body, /https:\/\/lukkaplace\.com\/listings\/286$/);
});

test('no link to a listing that is not live, no name when it is a number, no link on a bad number', () => {
  const body = text(leadWhatsAppLink({ wa_id: '243811111111', name: '243811111111', property_id: 9 }, [{ ...live, id: '9', approve_status: 0 }]));
  assert.match(body, /^Bonjour,/);
  assert.doesNotMatch(body, /lukkaplace\.com\/listings/);
  assert.equal(leadWhatsAppLink({ wa_id: '12' }), null);
});

test('alternatives: rows from the public search are stamped public, or ranking drops all of them', () => {
  // The bug: getListings does not SELECT status/approve_status, so shareBlocker read every row as pending.
  const fromSearch = { id: '5', purpose: 'rent', price: 500, beds: 2, listing_status: 'active' };
  assert.equal(rankAlternatives([fromSearch], { purpose: 'rent' }).length, 0);
  const src = read('lib/agentAlternatives.js');
  assert.match(src, /function asPublicRows/);
  assert.equal((src.match(/asPublicRows\(/g) || []).length, 6, 'every getListings / getListingsByIds read is stamped');
  assert.match(src, /includePublic = true/, 'nothing of their own widens to other agencies');
  assert.match(src, /purpose: null/, 'no purpose match falls back to every live listing of theirs');
});

test('the lead card: one direct WhatsApp action, no "Proposer un bien", no quota meter', () => {
  const card = read('components/AgentLeadCard.js');
  assert.doesNotMatch(card, /import {[^}]*proposeListingAction/);
  assert.doesNotMatch(card, /agent.leads.proposeProperty/);
  assert.match(card, /agent\.leads\.replyOnWhatsApp/);
  assert.match(card, /agent\.leads\.moreOptions/);
  assert.doesNotMatch(read('app/compte/agent/page.js'), /getAgentLeadQuota/);
  assert.doesNotMatch(read('app/compte/agent/abonnement/page.js'), /getAgentLeadQuota/);
});
