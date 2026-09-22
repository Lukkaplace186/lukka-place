import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildFormValuesFromParsed } from '@/lib/smartPaste';

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');

test('the agent form writes the listing reference on create and on edit', () => {
  const lib = read('lib/agentListings.js');
  assert.match(lib, /quartier = null, reference = null \}\) \{/, 'createListing takes a reference');
  assert.match(lib, /\s+reference,\s+price_period:/, 'and inserts it into properties');
  assert.match(lib, /reference = \$12/, 'updateListing writes it');
  const actions = read('app/compte/agent/actions.js');
  assert.equal((actions.match(/formData\.get\('reference'\)/g) || []).length, 2, 'both actions read the field');
});

test('both forms carry the field, and a smart paste fills it', () => {
  assert.match(read('components/CreateListingDialog.js'), /name="reference"/);
  assert.match(read('components/CreateListingDialog.js'), /DRAFT_FIELDS = \[[^\]]*'reference'/, 'offline drafts keep it');
  assert.match(read('components/AgentListingEditor.js'), /defaultValue=\{listing\.reference \|\| ''\}/);
  const mapped = buildFormValuesFromParsed({ reference: 'Mimosas, Camp Docteur' }, { communes: [], rawText: '' });
  assert.equal(mapped.reference, 'Mimosas, Camp Docteur');
});

test('Mes biens shows and searches the reference; Vue opens the form in place', () => {
  assert.match(read('lib/agencies.js'), /p\.reference, p\.sold_price/);
  assert.match(read('components/AgentListingsTable.js'), /Réf\. \{listing\.reference\}/);
  assert.match(read('app/compte/agent/biens/page.js'), /\$\{l\.reference \|\| ''\}/);
  const overview = read('app/compte/agent/page.js');
  assert.match(overview, /<CreateListingDialog\s+primary/);
  assert.doesNotMatch(overview, /href="\/compte\/agent\/biens"\s+className="u-btn-primary/);
});
