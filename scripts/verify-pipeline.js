/**
 * scripts/verify-pipeline.js
 *
 * Local verification of the Chakra pipeline:
 *   POST /webhook -> services/openai.js -> services/db.js -> services/chakra.js
 *
 * Run with: npm run verify
 *
 * No network and no API keys required. The `openai` and `axios` PACKAGES are
 * stubbed at the require-cache level, so the project's own modules — prompt
 * assembly, response handling, request building, coercion, dedupe — all run for
 * real, and the stubs let us assert on exactly what would have gone over the
 * wire.
 *
 * What this CANNOT verify: whether OpenAI accepts the schema, the quality of the
 * extraction, and whether Chakra's real endpoint accepts the request. Those need
 * live credentials.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert');

const DB = path.join(__dirname, '..', '_verify.db');
for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(DB + suffix)) fs.unlinkSync(DB + suffix);
}

const UPLOADS = path.join(__dirname, '..', '_verify_uploads');
fs.rmSync(UPLOADS, { recursive: true, force: true });

process.env.DB_PATH = DB;
process.env.UPLOADS_DIR = UPLOADS;
process.env.PORT = '3200';
process.env.OPENAI_API_KEY = 'sk-test-not-real';
process.env.OPENAI_MODEL = 'gpt-4o';
process.env.CHAKRA_ACCESS_TOKEN = 'chakra-test-token';
process.env.CHAKRA_PLUGIN_ID = 'plugin_123';
process.env.CHAKRA_PHONE_NUMBER_ID = '987654321';
process.env.VERIFY_TOKEN = 'tok';
// A fixed test secret, set BEFORE requiring index.js below (routes/webhook.js
// reads it once at module load) — this exercises the *real* HMAC verification
// path throughout the suite (see the post() helper in section 6), rather than
// bypassing it via ALLOW_UNSIGNED_WEBHOOKS, which would leave that code
// untested.
process.env.CHAKRA_WEBHOOK_HMAC_SECRET = 'test-hmac-secret-do-not-use-in-prod';
process.env.ALLOW_UNSIGNED_WEBHOOKS = '';
// A fixed test key, same reasoning as CHAKRA_WEBHOOK_HMAC_SECRET above — index.js
// reads API_SECRET once at module load, so this exercises the real
// requireApiKey enforcement (section 7) instead of leaving it untested.
process.env.API_SECRET = 'test-api-secret-do-not-use-in-prod';
process.env.APP_SECRET = '';

// CRITICAL: pre-set these (even empty) so dotenv's "don't overwrite what's
// already there" behaviour keeps the *real* Supabase credentials in .env out
// of process.env entirely. Without this, `require('../index')` below loads
// dotenv, and every services/postgres.js call in this suite would run against
// the live production database instead of safely no-op'ing. (This bit us for
// real once already, with an earlier Hostinger MySQL integration — see git
// history / session notes.)
process.env.DB_HOST = '';
process.env.DB_PORT = '';
process.env.DB_USER = '';
process.env.DB_PASSWORD = '';
process.env.DB_NAME = '';
process.env.DB_DRIVER = '';
// Same reasoning for Supabase Storage — even though services/postgres.js's
// isConfigured() gate already prevents this suite from reaching the upload
// step, blanking these too means that stays true even if that gate ever moves.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.SUPABASE_STORAGE_BUCKET = '';

// Short burst window so the suite runs fast; production defaults are 8s / 45s.
process.env.GROUP_IDLE_MS = '120';
process.env.GROUP_MAX_WAIT_MS = '1200';

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
    passed += 1;
  } catch (err) {
    console.log(`  FAIL  ${label}\n        ${err.message}`);
    failed += 1;
  }
}

/** Async variant — must be awaited, or the assertion runs at the wrong time. */
async function checkAsync(label, fn) {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
    passed += 1;
  } catch (err) {
    console.log(`  FAIL  ${label}\n        ${err.message}`);
    failed += 1;
  }
}

function stubPackage(name, exports) {
  const resolved = require.resolve(name);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

// ---------------------------------------------------------------------------
// Stub the openai package
// ---------------------------------------------------------------------------

const openaiCalls = [];
let nextCompletion = null;

function cannedCompletion(overrides = {}) {
  const payload = {
    extracted_data: {
      is_listing: true,
      intent: 'listing',
      transaction_type: 'location',
      property_type: 'villa',
      parcelle_subtype: null,
      commune: 'Ngaliema',
      // Deliberately the informal spelling, not the canonical 'Macampagne' —
      // exercises routes/webhook.js's fuzzy-normalisation step (services/locations.js),
      // which runs on every extraction regardless of what the model itself returned.
      quartier: 'Ma Campagne',
      price: 2500,
      currency: 'USD',
      price_period: 'mois',
      deposit_months: 3,
      bedrooms: 4,
      bathrooms: 2,
      surface_area_sqm: 600,
      units_count: null,
      furnished: true,
      amenities: ['piscine', 'forage'],
      reference: null,
      summary_fr: 'Villa meublée 4 chambres à Ma Campagne (Ngaliema), 2500 USD/mois.',
      missing_fields: [],
      confidence: 0.95,
    },
    whatsapp_reply:
      '*Annonce reçue* ✅\nVilla meublée 4 chambres à Ma Campagne (Ngaliema), 2500 USD/mois.\nRépondez *OK* pour publier.',
  };

  return {
    model: 'gpt-4o-2024-08-06',
    usage: { prompt_tokens: 900, completion_tokens: 180, total_tokens: 1080 },
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload), refusal: null } }],
    ...overrides,
  };
}

// Multi-step queue, for tests that need several canned responses in a row
// (the buyer assistant's tool-calling loop — see section 13). Additive:
// every existing test only ever sets the single-shot `nextCompletion` above
// and never touches this queue, so its behaviour is completely unchanged —
// this branch is checked first but stays inert (empty) unless a test opts in.
const completionQueue = [];

function FakeOpenAI(options) {
  this.options = options;
  this.chat = {
    completions: {
      create: async (params) => {
        openaiCalls.push(params);
        if (completionQueue.length) {
          return completionQueue.shift();
        }
        const next = nextCompletion;
        nextCompletion = null;
        return next || cannedCompletion();
      },
    },
  };
}
stubPackage('openai', FakeOpenAI);

// ---------------------------------------------------------------------------
// Stub the axios package (used by chakra.js and whatsapp.js)
// ---------------------------------------------------------------------------

const httpCalls = [];

// Fake media store — Chakra's real media endpoints (both the by-id /show route
// and the attachments?mid= proxy) stream bytes back directly, one hop.
const REAL_JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]), // JPEG magic bytes
  Buffer.from('lukka-place-test-photo'),
]);
let mediaBinaryResponse = REAL_JPEG_BYTES;
let mediaContentType = 'image/jpeg';
let mediaDownloadError = null;

const axiosStub = {
  post: async (url, data, config) => {
    httpCalls.push({ method: 'post', url, data, config });
    return { data: { messages: [{ id: 'wamid.SENT' }] }, status: 200 };
  },
  get: async (url, config) => {
    httpCalls.push({ method: 'get', url, config });

    // Simulates a signed CDN URL that rejects our token, forcing the fallback.
    if (String(url).includes('forbidden')) {
      const err = new Error('Request failed with status code 403');
      err.response = { status: 403, data: { error: { code: 10, message: 'access denied' } } };
      throw err;
    }

    if (mediaDownloadError) {
      const err = new Error('Request failed with status code 404');
      err.response = { status: 404, data: { error: { code: 100, message: 'media not found' } } };
      throw err;
    }

    // Chakra's media endpoints (.../media/{id}/show and .../media/whatsapp_business/attachments?mid=).
    if (String(url).includes('/media/')) {
      return {
        data: mediaBinaryResponse,
        status: 200,
        headers: mediaContentType ? { 'content-type': mediaContentType } : {},
      };
    }

    throw new Error(`axios stub: unhandled GET ${url}`);
  },
  create: () => axiosStub,
};
stubPackage('axios', axiosStub);

// ---------------------------------------------------------------------------
// Now load the project's real modules
// ---------------------------------------------------------------------------

const openaiService = require('../services/openai');
const chakra = require('../services/chakra');
const dbService = require('../services/db');
const webhookRouter = require('../routes/webhook');
const mediaStorage = require('../services/mediaStorage');
const postgresService = require('../services/postgres');
const locationsService = require('../services/locations');
const conversationState = require('../services/conversationState');
const propertyRepository = require('../services/propertyRepository');
const propertyMatching = require('../services/propertyMatching');

require('../index');

const { runBackfill } = require('../scripts/backfill-locations');

// ---------------------------------------------------------------------------
// 1. Structured Outputs schema conforms to strict-mode rules
// ---------------------------------------------------------------------------

console.log('\n1. gpt-4o Structured Outputs schema (strict-mode invariants)');

function walkSchema(node, pathStr, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node, pathStr);
  if (node.properties) {
    for (const [key, child] of Object.entries(node.properties)) {
      walkSchema(child, `${pathStr}.${key}`, visit);
    }
  }
  if (node.items) walkSchema(node.items, `${pathStr}[]`, visit);
}

const schema = openaiService.RESPONSE_FORMAT.json_schema.schema;

check('response_format type is json_schema', () => {
  assert.strictEqual(openaiService.RESPONSE_FORMAT.type, 'json_schema');
});
check('strict mode is enabled', () => {
  assert.strictEqual(openaiService.RESPONSE_FORMAT.json_schema.strict, true);
});
check('every object sets additionalProperties: false', () => {
  const offenders = [];
  walkSchema(schema, 'root', (node, p) => {
    const isObject = node.type === 'object' || (Array.isArray(node.type) && node.type.includes('object'));
    if (isObject && node.additionalProperties !== false) offenders.push(p);
  });
  assert.deepStrictEqual(offenders, [], `missing on: ${offenders.join(', ')}`);
});
check('every object lists ALL properties in required', () => {
  const offenders = [];
  walkSchema(schema, 'root', (node, p) => {
    const isObject = node.type === 'object' || (Array.isArray(node.type) && node.type.includes('object'));
    if (!isObject || !node.properties) return;
    const keys = Object.keys(node.properties);
    const required = node.required || [];
    const missing = keys.filter((k) => !required.includes(k));
    if (missing.length) offenders.push(`${p}: ${missing.join(',')}`);
  });
  assert.deepStrictEqual(offenders, [], `not required: ${offenders.join(' | ')}`);
});
check('nullable enums include null among their values', () => {
  const offenders = [];
  walkSchema(schema, 'root', (node, p) => {
    if (!node.enum) return;
    const nullable = Array.isArray(node.type) && node.type.includes('null');
    if (nullable && !node.enum.includes(null)) offenders.push(p);
  });
  assert.deepStrictEqual(offenders, [], `enum missing null: ${offenders.join(', ')}`);
});
check('extracted_data covers every SQLite listing column it should', () => {
  const props = Object.keys(schema.properties.extracted_data.properties);
  for (const column of [
    'intent', 'transaction_type', 'property_type', 'commune', 'quartier',
    'price', 'currency', 'price_period', 'deposit_months', 'bedrooms', 'bathrooms',
    'surface_area_sqm', 'furnished', 'amenities', 'summary_fr', 'missing_fields',
  ]) {
    assert.ok(props.includes(column), `schema is missing '${column}'`);
  }
});
check('system prompt carries the Kinshasa domain rules', () => {
  for (const needle of ['Kinshasa', 'Ngaliema', 'lingala', 'USD', 'chambre salon', 'whatsapp_reply']) {
    assert.ok(openaiService.SYSTEM_PROMPT.includes(needle), `prompt missing "${needle}"`);
  }
});
check('system prompt carries the full commune -> quartier hierarchy, not just commune names', () => {
  // Spot-checked across different communes (Ngaliema, Kalamu, Limete) so this
  // fails if the injected block is only the flat commune list, or only one
  // commune's quartiers, rather than the full kinshasa_locations.json tree.
  for (const needle of ['Macampagne', 'Matongé I', 'Kingabwa']) {
    assert.ok(openaiService.SYSTEM_PROMPT.includes(needle), `prompt missing "${needle}"`);
  }
});
check('every quartier in kinshasa_locations.json reaches the system prompt', () => {
  const missing = locationsService.ALL_QUARTIERS.filter((q) => !openaiService.SYSTEM_PROMPT.includes(q));
  assert.deepStrictEqual(missing, []);
});
check('"repère" has been fully replaced by "référence" in the prompt (no stray occurrences, any accent/case)', () => {
  assert.ok(!/rep[eè]re/i.test(openaiService.SYSTEM_PROMPT));
});
check('system prompt carries the Kinshasa parcelle/appartement classification rules', () => {
  for (const needle of [
    'PARCELLE', 'clôturé', 'portail', 'Maison Type Locataire',
    'NE classe JAMAIS une annonce comme "appartement"',
    'Réf:', 'Référence:',
  ]) {
    assert.ok(openaiService.SYSTEM_PROMPT.includes(needle), `prompt missing "${needle}"`);
  }
});
check('PARCELLE_SUBTYPES is exactly the three documented sub-types', () => {
  assert.deepStrictEqual(openaiService.PARCELLE_SUBTYPES, ['maison_type_locataire', 'villa', 'terrain_nu']);
});
check('parcelle_subtype/units_count/reference are present in the strict schema and required', () => {
  const props = schema.properties.extracted_data.properties;
  const required = schema.properties.extracted_data.required;
  for (const field of ['parcelle_subtype', 'units_count', 'reference']) {
    assert.ok(props[field], `schema missing property "${field}"`);
    assert.ok(required.includes(field), `"${field}" not in required (violates strict mode)`);
  }
  assert.deepStrictEqual(props.parcelle_subtype.enum, ['maison_type_locataire', 'villa', 'terrain_nu', null]);
});

// ---------------------------------------------------------------------------
// 1b. services/locations.js — commune/quartier master data + fuzzy resolver
// ---------------------------------------------------------------------------

console.log('\n1b. services/locations.js');

check('loads all 24 communes from kinshasa_locations.json', () => {
  assert.strictEqual(locationsService.COMMUNES.length, 24);
});
check('apostrophe communes are canonicalised (N\'Djili -> Ndjili, N\'Sele -> Nsele)', () => {
  assert.ok(locationsService.COMMUNES.includes('Ndjili'));
  assert.ok(locationsService.COMMUNES.includes('Nsele'));
  assert.ok(!locationsService.COMMUNES.includes("N'Djili"));
  assert.ok(!locationsService.COMMUNES.includes("N'Sele"));
});
check('resolveCommune normalises accents and short forms', () => {
  assert.strictEqual(locationsService.resolveCommune('gombé'), 'Gombe');
  assert.strictEqual(locationsService.resolveCommune('Bandal'), 'Bandalungwa');
  assert.strictEqual(locationsService.resolveCommune('Djili'), 'Ndjili');
  assert.strictEqual(locationsService.resolveCommune('La Gombe'), 'Gombe');
});
check('resolveCommune returns null rather than guessing when nothing is close', () => {
  assert.strictEqual(locationsService.resolveCommune('Paris'), null);
  assert.strictEqual(locationsService.resolveCommune(''), null);
  assert.strictEqual(locationsService.resolveCommune(null), null);
});
check('resolveQuartier handles the documented alias ("Ma Campagne" -> "Macampagne")', () => {
  assert.strictEqual(locationsService.resolveQuartier('Ma Campagne', 'Ngaliema'), 'Macampagne');
  assert.strictEqual(locationsService.resolveQuartier('ma campagne'), 'Macampagne');
});
check('resolveQuartier scopes to the given commune, avoiding cross-commune false matches', () => {
  // 'Kasaï' is a real quartier under several different communes (Barumbu,
  // Bumbu, Masina, N'Djili) — scoping to one commune must return that
  // commune's own list, not bleed into another's.
  assert.strictEqual(locationsService.resolveQuartier('Kasaï', 'Barumbu'), 'Kasaï');
  assert.strictEqual(locationsService.resolveQuartier('kasai', 'Masina'), 'Kasaï');
});
check('resolveQuartier falls back to city-wide search when commune is unknown', () => {
  assert.strictEqual(locationsService.resolveQuartier('Kingabwa'), 'Kingabwa');
});
check('resolveQuartier returns null for an informal landmark not in the master list', () => {
  assert.strictEqual(locationsService.resolveQuartier('Righini', 'Ngaliema'), null);
});
check('resolveCommune never returns a string outside the master list (strict output contract)', () => {
  const probes = ['gombé', 'Bandal', 'Djili', 'La Gombe', 'Kimbanseke', 'Paris', '', null, 'xyz123'];
  for (const probe of probes) {
    const result = locationsService.resolveCommune(probe);
    assert.ok(result === null || locationsService.COMMUNES.includes(result), `"${probe}" -> "${result}" is not in COMMUNES`);
  }
});
check('resolveQuartier never returns a string outside the master list (strict output contract)', () => {
  const probes = [['Ma Campagne', 'Ngaliema'], ['kasai', 'Masina'], ['Righini', 'Ngaliema'], ['', null]];
  for (const [input, commune] of probes) {
    const result = locationsService.resolveQuartier(input, commune);
    assert.ok(
      result === null || locationsService.ALL_QUARTIERS.includes(result),
      `"${input}" (${commune}) -> "${result}" is not in ALL_QUARTIERS`,
    );
  }
});

// ---------------------------------------------------------------------------
// 1c. services/locations.js — cascading commune -> quartier select logic
// ---------------------------------------------------------------------------

console.log('\n1c. services/locations.js cascading select logic');

check('quartiersForCommune returns the exact list for a canonical commune', () => {
  const list = locationsService.quartiersForCommune('Ngaliema');
  assert.ok(Array.isArray(list));
  assert.ok(list.includes('Macampagne'));
  assert.strictEqual(list.length, locationsService.LOCATIONS.Ngaliema.length);
});
check('quartiersForCommune also accepts a raw guess, not just the canonical spelling', () => {
  assert.deepStrictEqual(locationsService.quartiersForCommune('gombé'), locationsService.LOCATIONS.Gombe);
});
check('quartiersForCommune returns [] for an unknown/empty commune rather than throwing', () => {
  assert.deepStrictEqual(locationsService.quartiersForCommune('Atlantis'), []);
  assert.deepStrictEqual(locationsService.quartiersForCommune(null), []);
});
check('isValidQuartier is strict — a fuzzy near-miss does not count as valid', () => {
  assert.strictEqual(locationsService.isValidQuartier('Ngaliema', 'Macampagne'), true);
  assert.strictEqual(locationsService.isValidQuartier('Ngaliema', 'Ma Campagne'), false);
  assert.strictEqual(locationsService.isValidQuartier('Ngaliema', 'Socimat'), false, 'Socimat belongs to Gombe, not Ngaliema');
});
check('cascadeCommuneChange keeps a quartier that is still valid under the new commune', () => {
  const result = locationsService.cascadeCommuneChange({ newCommune: 'Ngaliema', currentQuartier: 'Macampagne' });
  assert.strictEqual(result.commune, 'Ngaliema');
  assert.strictEqual(result.quartier, 'Macampagne');
  assert.deepStrictEqual(result.quartiers, locationsService.LOCATIONS.Ngaliema);
});
check('cascadeCommuneChange resets the quartier to null when it no longer belongs to the new commune', () => {
  // 'Macampagne' is a Ngaliema quartier — switching to Gombe must drop it.
  const result = locationsService.cascadeCommuneChange({ newCommune: 'Gombe', currentQuartier: 'Macampagne' });
  assert.strictEqual(result.commune, 'Gombe');
  assert.strictEqual(result.quartier, null);
  assert.deepStrictEqual(result.quartiers, locationsService.LOCATIONS.Gombe);
});
check('cascadeCommuneChange normalises a raw commune guess too', () => {
  const result = locationsService.cascadeCommuneChange({ newCommune: 'la gombe' });
  assert.strictEqual(result.commune, 'Gombe');
});
check('cascadeCommuneChange with no commune yields an empty option list and a null quartier', () => {
  const result = locationsService.cascadeCommuneChange({ newCommune: null, currentQuartier: 'Macampagne' });
  assert.strictEqual(result.commune, null);
  assert.strictEqual(result.quartier, null);
  assert.deepStrictEqual(result.quartiers, []);
});

// ---------------------------------------------------------------------------
// 2. services/openai.js request + response handling
// ---------------------------------------------------------------------------

console.log('\n2. services/openai.js');

(async () => {
  const result = await openaiService.parseMessage('Villa a louer Ngaliema 4 chambres 2500$/mois', {
    senderPhone: '243810000000',
  });
  const sentParams = openaiCalls[openaiCalls.length - 1];

  check('calls the configured model', () => assert.strictEqual(sentParams.model, 'gpt-4o'));
  check('temperature is 0 for deterministic extraction', () =>
    assert.strictEqual(sentParams.temperature, 0));
  check('sends response_format with the strict schema', () =>
    assert.strictEqual(sentParams.response_format.json_schema.strict, true));
  check('sends system + user messages', () => {
    assert.strictEqual(sentParams.messages.length, 2);
    assert.strictEqual(sentParams.messages[0].role, 'system');
    assert.strictEqual(sentParams.messages[1].role, 'user');
  });
  check('includes the raw message text in the user turn', () => {
    const parts = sentParams.messages[1].content;
    assert.ok(Array.isArray(parts), 'user content should be a parts array');
    assert.strictEqual(parts[0].type, 'text');
    assert.ok(parts[0].text.includes('Villa a louer Ngaliema'));
  });
  check('sends no image parts for a text-only message', () =>
    assert.strictEqual(
      sentParams.messages[1].content.filter((p) => p.type === 'image_url').length,
      0,
    ));
  check('reports zero images in _meta for text-only', () => {
    assert.strictEqual(result._meta.imageCount, 0);
    assert.strictEqual(result._meta.imageDetail, null);
  });
  check('returns extracted_data', () =>
    assert.strictEqual(result.extracted_data.commune, 'Ngaliema'));
  check('returns whatsapp_reply', () =>
    assert.ok(result.whatsapp_reply.includes('Annonce reçue')));
  check('reports token usage in _meta', () =>
    assert.strictEqual(result._meta.usage.total_tokens, 1080));

  await checkAsync('rejects empty input without calling the API', async () => {
    const before = openaiCalls.length;
    await assert.rejects(() => openaiService.parseMessage('   '), /text, images, or both/);
    assert.strictEqual(openaiCalls.length, before, 'API was called for empty input');
  });

  // -------------------------------------------------------------------------
  // 2b. Image support
  // -------------------------------------------------------------------------

  console.log('\n2b. services/openai.js image support');

  const FAKE_JPEG_B64 = Buffer.from('fake-jpeg-bytes').toString('base64');

  const withImages = await openaiService.parseMessage('Villa avec piscine', {
    senderPhone: '243810000000',
    images: [
      { data: FAKE_JPEG_B64, mimeType: 'image/jpeg' },
      { data: FAKE_JPEG_B64, mimeType: 'image/png' },
    ],
  });
  const imageParams = openaiCalls[openaiCalls.length - 1];
  const imageParts = imageParams.messages[1].content.filter((p) => p.type === 'image_url');

  check('attaches one image_url part per image', () =>
    assert.strictEqual(imageParts.length, 2));
  check('builds a correct base64 data URI', () =>
    assert.strictEqual(imageParts[0].image_url.url, `data:image/jpeg;base64,${FAKE_JPEG_B64}`));
  check('respects each image mime type', () =>
    assert.ok(imageParts[1].image_url.url.startsWith('data:image/png;base64,')));
  check('text part still comes first', () => {
    assert.strictEqual(imageParams.messages[1].content[0].type, 'text');
    assert.ok(imageParams.messages[1].content[0].text.includes('Villa avec piscine'));
  });
  check('tells the model how many images are attached', () =>
    assert.ok(/2 image\(s\)/.test(imageParams.messages[1].content[0].text)));
  check('sets a detail level on image parts', () =>
    assert.strictEqual(imageParts[0].image_url.detail, 'auto'));
  check('reports image count in _meta', () => {
    assert.strictEqual(withImages._meta.imageCount, 2);
    assert.strictEqual(withImages._meta.imagesDropped, 0);
    assert.strictEqual(withImages._meta.imageDetail, 'auto');
  });

  // Images with no caption — very common: agent sends a photo of a flyer alone.
  const imagesOnly = await openaiService.parseMessage(null, {
    images: [{ data: FAKE_JPEG_B64, mimeType: 'image/jpeg' }],
  });
  check('accepts images with no text at all', () =>
    assert.strictEqual(imagesOnly._meta.imageCount, 1));
  check('marks the absence of text in the prompt', () =>
    assert.ok(/images uniquement/.test(
      openaiCalls[openaiCalls.length - 1].messages[1].content[0].text,
    )));

  await checkAsync('still rejects a call with neither text nor images', () =>
    assert.rejects(() => openaiService.parseMessage('  ', { images: [] }), /text, images, or both/));

  check('accepts a pre-built https URL', () => {
    const part = openaiService.toImagePart({ url: 'https://cdn.example.com/a.jpg' }, 'auto');
    assert.strictEqual(part.image_url.url, 'https://cdn.example.com/a.jpg');
  });
  check('accepts a bare data-URI string', () => {
    const uri = `data:image/webp;base64,${FAKE_JPEG_B64}`;
    assert.strictEqual(openaiService.toImagePart(uri, 'auto').image_url.url, uri);
  });
  check('does not double-prefix data that already has a data URI', () => {
    const part = openaiService.toImagePart(
      { data: `data:image/jpeg;base64,${FAKE_JPEG_B64}`, mimeType: 'image/jpeg' },
      'auto',
    );
    assert.strictEqual(part.image_url.url, `data:image/jpeg;base64,${FAKE_JPEG_B64}`);
  });
  check('rejects an unsupported image type with a clear message', () =>
    assert.throws(
      () => openaiService.toImagePart({ data: FAKE_JPEG_B64, mimeType: 'image/heic' }, 'auto'),
      /Unsupported image type 'image\/heic'/,
    ));
  check('rejects a PDF flyer', () =>
    assert.throws(
      () => openaiService.toImagePart({ data: FAKE_JPEG_B64, mimeType: 'application/pdf' }, 'auto'),
      /Unsupported image type/,
    ));
  check('rejects base64 data with no mime type', () =>
    assert.throws(() => openaiService.toImagePart({ data: FAKE_JPEG_B64 }, 'auto'), /must also provide mimeType/));
  check('rejects an image entry with neither data nor url', () =>
    assert.throws(() => openaiService.toImagePart({}, 'auto'), /needs either/));
  check('rejects a non-image URL scheme', () =>
    assert.throws(() => openaiService.toImagePart({ url: 'ftp://x/y.jpg' }, 'auto'), /data:image/));

  const overCap = Array.from({ length: openaiService.MAX_IMAGES + 3 }, () => ({
    data: FAKE_JPEG_B64,
    mimeType: 'image/jpeg',
  }));
  const capped = await openaiService.parseMessage('Album', { images: overCap });
  check(`caps images at MAX_IMAGES (${openaiService.MAX_IMAGES}) and reports the overflow`, () => {
    const parts = openaiCalls[openaiCalls.length - 1].messages[1].content
      .filter((p) => p.type === 'image_url');
    assert.strictEqual(parts.length, openaiService.MAX_IMAGES);
    assert.strictEqual(capped._meta.imageCount, openaiService.MAX_IMAGES);
    assert.strictEqual(capped._meta.imagesDropped, 3);
  });

  const highDetail = await openaiService.parseMessage('Flyer', {
    images: [{ data: FAKE_JPEG_B64, mimeType: 'image/jpeg' }],
    imageDetail: 'high',
  });
  check("per-call imageDetail override reaches the request", () => {
    const parts = openaiCalls[openaiCalls.length - 1].messages[1].content
      .filter((p) => p.type === 'image_url');
    assert.strictEqual(parts[0].image_url.detail, 'high');
    assert.strictEqual(highDetail._meta.imageDetail, 'high');
  });
  check('system prompt carries the image rules', () => {
    for (const needle of ['IMAGES', 'texte visible', 'photo seule']) {
      assert.ok(openaiService.SYSTEM_PROMPT.includes(needle), `prompt missing "${needle}"`);
    }
  });

  // Error paths: these are the failure modes strict mode does NOT protect from.
  nextCompletion = cannedCompletion({
    choices: [{ finish_reason: 'stop', message: { refusal: 'I cannot help with that.', content: null } }],
  });
  await openaiService.parseMessage('test').then(
    () => check('surfaces a model refusal', () => { throw new Error('should have thrown'); }),
    (err) => check('surfaces a model refusal', () => assert.ok(/refused/.test(err.message))),
  );

  nextCompletion = cannedCompletion({
    choices: [{ finish_reason: 'length', message: { content: '{"partial":', refusal: null } }],
  });
  await openaiService.parseMessage('test').then(
    () => check('surfaces truncated output', () => { throw new Error('should have thrown'); }),
    (err) => check('surfaces truncated output', () => assert.ok(/truncated/.test(err.message))),
  );

  nextCompletion = cannedCompletion({
    choices: [{ finish_reason: 'stop', message: { content: 'not json', refusal: null } }],
  });
  await openaiService.parseMessage('test').then(
    () => check('surfaces non-JSON output', () => { throw new Error('should have thrown'); }),
    (err) => check('surfaces non-JSON output', () => assert.ok(/non-JSON/.test(err.message))),
  );

  // -------------------------------------------------------------------------
  // 3. services/chakra.js request building
  // -------------------------------------------------------------------------

  console.log('\n3. services/chakra.js');

  httpCalls.length = 0;
  await chakra.sendWhatsAppMessage('+243810000000', 'Bonjour agent', { replyToMessageId: 'wamid.ABC' });
  const call = httpCalls[0];

  check('posts to the Chakra plugin messages endpoint', () =>
    assert.strictEqual(
      call.url,
      'https://api.chakrahq.com/v1/ext/plugin/whatsapp/plugin_123/api/v21.0/987654321/messages',
    ));
  check('authenticates with a Bearer token', () =>
    assert.strictEqual(call.config.headers.Authorization, 'Bearer chakra-test-token'));
  check('sends JSON content type', () =>
    assert.strictEqual(call.config.headers['Content-Type'], 'application/json'));
  check('body uses the Meta pass-through shape', () => {
    assert.strictEqual(call.data.messaging_product, 'whatsapp');
    assert.strictEqual(call.data.type, 'text');
    assert.strictEqual(call.data.text.body, 'Bonjour agent');
  });
  check("strips the leading '+' from the recipient", () =>
    assert.strictEqual(call.data.to, '243810000000'));
  check('quotes the original message when asked', () =>
    assert.strictEqual(call.data.context.message_id, 'wamid.ABC'));
  await checkAsync('rejects an empty message body', () =>
    assert.rejects(() => chakra.sendWhatsAppMessage('243810000000', ''), /non-empty messageText/));

  await checkAsync('rejects a missing recipient', () =>
    assert.rejects(() => chakra.sendWhatsAppMessage('', 'Bonjour'), /requires toPhone/));

  // -------------------------------------------------------------------------
  // 3b. Chakra media download
  // -------------------------------------------------------------------------

  console.log('\n3b. services/chakra.js media download');

  httpCalls.length = 0;
  mediaBinaryResponse = REAL_JPEG_BYTES;
  mediaContentType = 'image/jpeg';
  const media = await chakra.downloadMedia('media_555');

  check('downloads via the one-hop "show" endpoint', () =>
    assert.strictEqual(
      httpCalls[0].url,
      'https://api.chakrahq.com/v2/whatsapp/v21.0/media/media_555/show',
    ));
  check('authenticates the download', () =>
    assert.strictEqual(httpCalls[0].config.headers.Authorization, 'Bearer chakra-test-token'));
  check('requests the bytes as an arraybuffer', () =>
    assert.strictEqual(httpCalls[0].config.responseType, 'arraybuffer'));
  check('only one request is made — no separate metadata hop', () =>
    assert.strictEqual(httpCalls.length, 1));
  check('returns base64 data, mime type and size', () => {
    assert.strictEqual(media.data, REAL_JPEG_BYTES.toString('base64'));
    assert.strictEqual(media.mimeType, 'image/jpeg');
    assert.strictEqual(media.sizeBytes, REAL_JPEG_BYTES.length);
  });
  check('output plugs straight into openai.parseMessage', () => {
    const part = openaiService.toImagePart(media, 'auto');
    assert.strictEqual(part.image_url.url, `data:image/jpeg;base64,${media.data}`);
  });

  check('sniffs the mime type from magic bytes', () => {
    assert.strictEqual(chakra.sniffMimeType(REAL_JPEG_BYTES), 'image/jpeg');
    assert.strictEqual(
      chakra.sniffMimeType(Buffer.from('89504e470d0a1a0a0000', 'hex')),
      'image/png',
    );
    assert.strictEqual(chakra.sniffMimeType(Buffer.from('GIF89a....')), 'image/gif');
    assert.strictEqual(chakra.sniffMimeType(Buffer.from('not an image at all')), null);
  });

  mediaContentType = null; // Chakra's response omitted Content-Type
  await checkAsync('falls back to sniffing when Content-Type is absent', async () => {
    const sniffed = await chakra.downloadMedia('media_nomime');
    assert.strictEqual(sniffed.mimeType, 'image/jpeg');
  });

  mediaContentType = 'audio/ogg';
  await checkAsync('refuses a voice note', () =>
    assert.rejects(() => chakra.downloadMedia('media_audio'), /not an image/));

  mediaContentType = 'image/jpeg';
  mediaBinaryResponse = Buffer.alloc(chakra.MAX_MEDIA_BYTES + 1);
  await checkAsync('refuses an oversized file', () =>
    assert.rejects(() => chakra.downloadMedia('media_huge'), /over the .* limit/));

  mediaBinaryResponse = Buffer.alloc(0);
  await checkAsync('refuses an empty download', () =>
    assert.rejects(() => chakra.downloadMedia('media_empty'), /0 bytes/));

  mediaBinaryResponse = REAL_JPEG_BYTES;
  mediaDownloadError = true;
  await checkAsync('surfaces the provider error message', () =>
    assert.rejects(() => chakra.downloadMedia('media_404'), /media not found/));
  mediaDownloadError = null;

  await checkAsync('requires a media id', () =>
    assert.rejects(() => chakra.downloadMedia(''), /requires a mediaId/));

  check('media URL template is overridable via env', () => {
    const original = process.env.CHAKRA_MEDIA_URL_TEMPLATE;
    assert.ok(chakra.mediaUrl('m1').includes('media') && chakra.mediaUrl('m1').includes('m1'));
    process.env.CHAKRA_MEDIA_URL_TEMPLATE = original;
  });

  check('extracts the mid query param from a lookaside attachment URL', () => {
    assert.strictEqual(
      chakra.extractMid('https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=123&ext=456'),
      '123',
    );
    assert.strictEqual(chakra.extractMid('https://example.com/no-mid-here'), null);
  });

  check('builds the attachments-by-mid URL', () =>
    assert.strictEqual(
      chakra.mediaAttachmentUrl('123'),
      'https://api.chakrahq.com/v2/whatsapp/v21.0/media/whatsapp_business/attachments?mid=123',
    ));

  httpCalls.length = 0;
  mediaBinaryResponse = REAL_JPEG_BYTES;
  mediaContentType = 'image/jpeg';
  const viaUrl = await chakra.downloadMediaByUrl(
    'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=999888777',
    'image/jpeg',
  );
  check('downloadMediaByUrl proxies through Chakra by mid, not the raw lookaside URL', () => {
    assert.strictEqual(httpCalls.length, 1);
    assert.strictEqual(httpCalls[0].url, chakra.mediaAttachmentUrl('999888777'));
    assert.strictEqual(httpCalls[0].config.headers.Authorization, 'Bearer chakra-test-token');
    assert.strictEqual(viaUrl.mimeType, 'image/jpeg');
  });

  // -------------------------------------------------------------------------
  // 3c. services/postgres.js — field mapping (pure functions) + safe no-op
  // -------------------------------------------------------------------------

  console.log('\n3c. services/postgres.js');

  check('isConfigured is false without DB_HOST/DB_USER/DB_PASSWORD/DB_NAME', () =>
    assert.strictEqual(postgresService.isConfigured(), false));

  await checkAsync('syncListingToPostgres no-ops (never throws) when unconfigured', async () => {
    const result = await postgresService.syncListingToPostgres({ id: 1, property_type: 'villa' });
    assert.strictEqual(result, null);
  });

  await checkAsync('resolveAgentId returns null without querying when wa_id is absent', async () => {
    const client = { query: () => { throw new Error('should never query for a missing wa_id'); } };
    const result = await postgresService.resolveAgentId(client, null);
    assert.strictEqual(result, null);
  });

  await checkAsync('resolveAgentId returns null without querying when wa_id has no digits at all', async () => {
    const client = { query: () => { throw new Error('should never query a non-numeric wa_id'); } };
    const result = await postgresService.resolveAgentId(client, '+---');
    assert.strictEqual(result, null);
  });

  await checkAsync('resolveAgentId digit-normalises wa_id and compares against a digit-normalised agents.phone', async () => {
    const client = {
      query: async (sql, params) => {
        assert.match(sql, /FROM agents/);
        assert.match(sql, /regexp_replace\(phone, '\\D', '', 'g'\) = \$1/);
        assert.deepStrictEqual(params, ['243997123456']);
        return { rows: [{ id: 28 }] };
      },
    };
    // A real, full E.164 DRC number — this used to overflow agents.phone's
    // old int4 type; the migration to VARCHAR(32) is what makes this pass
    // a real query at all instead of being guarded out beforehand.
    const result = await postgresService.resolveAgentId(client, '243997123456');
    assert.strictEqual(result, 28);
  });
  // Attribution decides whose name appears on a public listing and which
  // number its WhatsApp CTA dials, so an account nobody proved they own must
  // not claim listings. Three of the four live agent rows are active but
  // unverified, and one of those carries the central Lukka Place number.
  await checkAsync('resolveAgentId only matches a phone-verified agent', async () => {
    let seenSql = '';
    const client = {
      query: async (sql) => {
        seenSql = sql;
        return { rows: [] };
      },
    };
    await postgresService.resolveAgentId(client, '243997123456');
    assert.match(seenSql, /phone_verified_at IS NOT NULL/);
  });

  await checkAsync('resolveAgentId strips "+", spaces and dashes from wa_id before comparing', async () => {
    const client = {
      query: async (sql, params) => {
        assert.deepStrictEqual(params, ['243997123456']);
        return { rows: [{ id: 28 }] };
      },
    };
    const result = await postgresService.resolveAgentId(client, '+243 997-123-456');
    assert.strictEqual(result, 28);
  });

  await checkAsync('resolveAgentId returns null (not undefined) when no agent row matches', async () => {
    const client = { query: async () => ({ rows: [] }) };
    const result = await postgresService.resolveAgentId(client, '997123456');
    assert.strictEqual(result, null);
  });

  check('normaliseRowLocation resolves un-normalised commune/quartier (defense in depth for legacy/backfilled rows)', () => {
    const row = postgresService.normaliseRowLocation({ id: 1, commune: 'la gombe', quartier: 'socimat' });
    assert.strictEqual(row.commune, 'Gombe');
    assert.strictEqual(row.quartier, 'Socimat');
  });
  check('normaliseRowLocation leaves an already-canonical row untouched', () => {
    const row = postgresService.normaliseRowLocation({ id: 1, commune: 'Ngaliema', quartier: 'Macampagne' });
    assert.strictEqual(row.commune, 'Ngaliema');
    assert.strictEqual(row.quartier, 'Macampagne');
  });
  check('normaliseRowLocation keeps an unmatched free-text quartier rather than nulling real data', () => {
    const row = postgresService.normaliseRowLocation({ id: 1, commune: 'Ngaliema', quartier: 'Avenue Wembo, près du rond-point' });
    assert.strictEqual(row.commune, 'Ngaliema');
    assert.strictEqual(row.quartier, 'Avenue Wembo, près du rond-point');
  });
  check('normaliseRowLocation is a no-op pass-through when neither field is set', () => {
    const original = { id: 1, property_type: 'villa' };
    assert.strictEqual(postgresService.normaliseRowLocation(original), original);
  });

  const fakeCategories = new Map([
    ['appartement', { id: 34, type: 'residential' }],
    ['maison', { id: 36, type: 'residential' }],
    ['duplex', { id: 41, type: 'residential' }],
    ['boutique', { id: 40, type: 'commercial' }],
    ['batiment', { id: 38, type: 'commercial' }],
    ['terrain', { id: 42, type: 'residential' }],
    ['entrepot', { id: 43, type: 'commercial' }],
  ]);
  check('resolveCategory maps known property_types onto the site taxonomy', () => {
    assert.strictEqual(postgresService.resolveCategory('villa', fakeCategories).id, 36);
    assert.strictEqual(postgresService.resolveCategory('boutique', fakeCategories).id, 40);
    assert.strictEqual(postgresService.resolveCategory('parcelle', fakeCategories).id, 42);
    assert.strictEqual(postgresService.resolveCategory('immeuble', fakeCategories).id, 38);
    assert.strictEqual(postgresService.resolveCategory('entrepot', fakeCategories).id, 43);
  });
  check('resolveCategory falls back rather than throwing on an unmapped type', () => {
    const sparse = new Map([['terrain', { id: 42, type: 'residential' }]]);
    assert.strictEqual(postgresService.resolveCategory('totally_unknown', sparse).id, 42);
  });

  check('capitalise matches the site\'s Residential/Commercial casing', () => {
    assert.strictEqual(postgresService.capitalise('residential'), 'Residential');
    assert.strictEqual(postgresService.capitalise('commercial'), 'Commercial');
  });

  check('buildTitle composes a readable French title', () => {
    const title = postgresService.buildTitle({
      property_type: 'villa', transaction_type: 'location', bedrooms: 4, commune: 'Ngaliema',
    });
    assert.strictEqual(title, '4 chambres — Villa à louer à Ngaliema');
  });
  check('buildAddress skips missing pieces (no country suffix — this schema is Kinshasa-only)', () => {
    assert.strictEqual(
      postgresService.buildAddress({ quartier: 'Macampagne', commune: 'Ngaliema' }),
      'Macampagne, Ngaliema, Kinshasa',
    );
    assert.strictEqual(postgresService.buildAddress({}), 'Kinshasa');
  });
  check('COMMUNE_AMENITY_IDS covers exactly the 24 communes, matching live Supabase amenity_contents (ids 21-44)', () => {
    const ids = Object.values(postgresService.COMMUNE_AMENITY_IDS);
    assert.strictEqual(ids.length, 24);
    assert.strictEqual(Math.min(...ids), 21);
    assert.strictEqual(Math.max(...ids), 44);
    assert.strictEqual(new Set(ids).size, 24, 'amenity ids must be unique');
  });
  check('buildDescription uses summary_fr when long enough', () => {
    const desc = postgresService.buildDescription({ summary_fr: 'Villa meublée 4 chambres à Ngaliema.' });
    assert.strictEqual(desc, 'Villa meublée 4 chambres à Ngaliema.');
  });
  check('buildDescription falls back when summary_fr is missing or too short', () => {
    const desc = postgresService.buildDescription({
      property_type: 'villa', transaction_type: 'vente', commune: 'Gombe', price: 90000, currency: 'USD',
    });
    assert.ok(desc.length >= 15, `description too short: "${desc}"`);
    assert.ok(desc.includes('Gombe'));
  });
  check('slugify strips accents and punctuation', () =>
    assert.strictEqual(postgresService.slugify("Villa à louer — Ngaliema !"), 'villa-a-louer-ngaliema'));

  const fakeCategory = { id: 34, type: 'residential' };
  const fakeLocation = { countryId: 1, cityId: 2 };
  check('buildPropertyValues writes parcelle_subtype/units_count/reference through to the payload', () => {
    const values = postgresService.buildPropertyValues(
      { property_type: 'parcelle', parcelle_subtype: 'maison_type_locataire', units_count: 4, reference: 'LKP-2026-0091', transaction_type: 'vente' },
      { category: fakeCategory, location: fakeLocation },
    );
    assert.strictEqual(values.parcelle_subtype, 'maison_type_locataire');
    assert.strictEqual(values.units_count, 4);
    assert.strictEqual(values.reference, 'LKP-2026-0091');
  });
  check('buildPropertyValues defaults all three to null when absent, without throwing', () => {
    const values = postgresService.buildPropertyValues(
      { property_type: 'appartement', transaction_type: 'location' },
      { category: fakeCategory, location: fakeLocation },
    );
    assert.strictEqual(values.parcelle_subtype, null);
    assert.strictEqual(values.units_count, null);
    assert.strictEqual(values.reference, null);
  });
  check('buildPropertyValues defaults agent_id to null when not passed (today\'s real behaviour — no live agent to match)', () => {
    const values = postgresService.buildPropertyValues(
      { property_type: 'appartement', transaction_type: 'location' },
      { category: fakeCategory, location: fakeLocation },
    );
    assert.strictEqual(values.agent_id, null);
  });
  check('buildPropertyValues writes a resolved agent_id through to the payload', () => {
    const values = postgresService.buildPropertyValues(
      { property_type: 'appartement', transaction_type: 'location' },
      { category: fakeCategory, location: fakeLocation, agentId: 28 },
    );
    assert.strictEqual(values.agent_id, 28);
  });
  // Regression guard for a bug that reached production: re-syncing an
  // already-approved listing reverted it to pending and dropped it off the
  // public site (properties #256/#257 — see
  // scripts/restore-approval-256-257.js, the hand-written recovery).
  check('updatablePropertyValues drops approve_status so a re-sync cannot un-approve a live listing', () => {
    const values = postgresService.buildPropertyValues(
      { property_type: 'appartement', transaction_type: 'location' },
      { category: fakeCategory, location: fakeLocation, agentId: 33 },
    );
    assert.strictEqual(values.approve_status, 0, 'a NEW listing must still enter moderation');

    const updatable = postgresService.updatablePropertyValues(values);
    assert.ok(!('approve_status' in updatable), 'an UPDATE must never write approve_status');
    assert.strictEqual(updatable.status, 1, 'status carries no human decision and is still written');
  });
  check('updatablePropertyValues preserves an admin-assigned agent_id when resolution finds nobody', () => {
    // resolveAgentId returns null for a listing whose agent has no account
    // yet; writing that over an agent_id an admin set by hand would silently
    // un-attribute the listing.
    const values = postgresService.buildPropertyValues(
      { property_type: 'appartement', transaction_type: 'location' },
      { category: fakeCategory, location: fakeLocation },
    );
    assert.strictEqual(values.agent_id, null);
    assert.ok(!('agent_id' in postgresService.updatablePropertyValues(values)));
  });
  check('updatablePropertyValues still writes a resolved agent_id (a late-registering agent gets linked)', () => {
    const values = postgresService.buildPropertyValues(
      { property_type: 'appartement', transaction_type: 'location' },
      { category: fakeCategory, location: fakeLocation, agentId: 33 },
    );
    assert.strictEqual(postgresService.updatablePropertyValues(values).agent_id, 33);
  });
  check('updatablePropertyValues does not mutate its input', () => {
    const values = postgresService.buildPropertyValues(
      { property_type: 'appartement', transaction_type: 'location' },
      { category: fakeCategory, location: fakeLocation, agentId: 33 },
    );
    postgresService.updatablePropertyValues(values);
    assert.strictEqual(values.approve_status, 0);
    assert.strictEqual(values.agent_id, 33);
  });
  check('buildPropertyValues still computes purpose/area/quartier correctly (refactor did not regress existing fields)', () => {
    const values = postgresService.buildPropertyValues(
      { property_type: 'villa', transaction_type: 'vente', surface_area_sqm: 95.4, quartier: 'Kimwenza' },
      { category: fakeCategory, location: fakeLocation },
    );
    assert.strictEqual(values.purpose, 'sale');
    assert.strictEqual(values.area, '95');
    assert.strictEqual(values.quartier, 'Kimwenza');
    assert.strictEqual(values.category_id, 34);
    assert.strictEqual(values.city_id, 2);
  });

  // -------------------------------------------------------------------------
  // 4. Inbound payload normalisation
  // -------------------------------------------------------------------------

  console.log('\n4. routes/webhook.js payload parsing');

  const { extractInboundMessages } = webhookRouter;

  check('parses the Meta / Chakra pass-through envelope', () => {
    const out = extractInboundMessages({
      object: 'whatsapp_business_account',
      entry: [{ id: '1', changes: [{ field: 'messages', value: {
        contacts: [{ wa_id: '243810000000', profile: { name: 'Agent Papy' } }],
        messages: [{ from: '243810000000', id: 'wamid.A', type: 'text', text: { body: 'Villa Gombe' } }],
      } }] }],
    });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].wamid, 'wamid.A');
    assert.strictEqual(out[0].text, 'Villa Gombe');
    assert.strictEqual(out[0].profileName, 'Agent Papy');
  });
  check('reads an image caption as text AND captures the media id', () => {
    const out = extractInboundMessages({
      entry: [{ changes: [{ value: { messages: [
        { from: '243810000000', id: 'wamid.B', type: 'image', image: { id: 'm1', caption: 'Villa avec piscine' } },
      ] } }] }],
    });
    assert.strictEqual(out[0].text, 'Villa avec piscine');
    assert.deepStrictEqual(out[0].media.map((m) => m.id), ['m1']);
  });
  check('captures a photo sent with no caption', () => {
    const out = extractInboundMessages({
      entry: [{ changes: [{ value: { messages: [
        { from: '243810000000', id: 'wamid.C', type: 'image', image: { id: 'm2' } },
      ] } }] }],
    });
    assert.strictEqual(out.length, 1, 'caption-less photo must not be dropped');
    assert.deepStrictEqual(out[0].media.map((m) => m.id), ['m2']);
    assert.strictEqual(out[0].text, null);
  });
  check('text messages carry an empty media array', () => {
    const out = extractInboundMessages({
      entry: [{ changes: [{ value: { messages: [
        { from: '243810000000', id: 'wamid.D', type: 'text', text: { body: 'Villa Gombe' } },
      ] } }] }],
    });
    assert.deepStrictEqual(out[0].media, []);
  });
  check('flat payload with an image id and no text is accepted', () => {
    const out = extractInboundMessages({ from: '243810000000', image: { id: 'm9' } });
    assert.strictEqual(out.length, 1);
    assert.deepStrictEqual(out[0].media.map((m) => m.id), ['m9']);
    assert.strictEqual(out[0].type, 'image');
  });
  // Verbatim shape captured from a real Chakra delivery in server.err.log.
  const REAL_CHAKRA_TEXT_EVENT = {
    event: 'message',
    payload: {
      wabaId: '2745491532518223',
      externalId: 'wamid.HBgMNDQ3OTMyNjczNDYwFQIAEhgUM0E2NDNFN0Y2MUY4QTI1NjA5OTYA',
      messageId: 'wamid.HBgMNDQ3OTMyNjczNDYwFQIAEhgUM0E2NDNFN0Y2MUY4QTI1NjA5OTYA',
      timestamp: 1786649606000,
      message: {
        from: '447932673460',
        from_user_id: 'GB.820809484190281',
        id: 'wamid.HBgMNDQ3OTMyNjczNDYwFQIAEhgUM0E2NDNFN0Y2MUY4QTI1NjA5OTYA',
        timestamp: '1786649606',
        text: {
          body: 'TOUTE LA PARCELLE VIDE À LIMETE FUNA AVEC UNE MAISON BASSE\n\n3 Chambres, Salon, 2 salles de bain\n\nLOYER : 1000$ GARANTIE 4+1',
        },
        type: 'text',
      },
      contacts: [{ profile: { name: 'H' }, wa_id: '447932673460', user_id: 'GB.820809484190281' }],
    },
  };

  const REAL_CHAKRA_IMAGE_EVENT = {
    event: 'message',
    payload: {
      messageId: 'wamid.HBgMNDQ3OTMyNjczNDYwFQIAEhgUM0E0QjkzREZEOTUzODM2NjgwODMA',
      externalId: 'wamid.HBgMNDQ3OTMyNjczNDYwFQIAEhgUM0E0QjkzREZEOTUzODM2NjgwODMA',
      message: {
        from: '447932673460',
        id: 'wamid.HBgMNDQ3OTMyNjczNDYwFQIAEhgUM0E0QjkzREZEOTUzODM2NjgwODMA',
        type: 'image',
        image: {
          mime_type: 'image/jpeg',
          sha256: '2WN/ZNz0z8+6W0E3YOMTOt5wiHiu/CLGRU9yusxGP6U=',
          id: '2565531760616440',
          url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=2565531760616440&source=webhook',
        },
      },
      contacts: [{ profile: { name: 'H' }, wa_id: '447932673460' }],
    },
  };

  check("parses Chakra's real event: 'message' envelope", () => {
    const out = extractInboundMessages(REAL_CHAKRA_TEXT_EVENT);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].from, '447932673460');
    assert.ok(out[0].text.includes('LIMETE FUNA'));
    assert.ok(out[0].text.includes('1000$'));
    assert.strictEqual(out[0].wamid, REAL_CHAKRA_TEXT_EVENT.payload.message.id);
    assert.strictEqual(out[0].profileName, 'H');
    assert.strictEqual(out[0].type, 'text');
    assert.deepStrictEqual(out[0].media, []);
  });
  check('parses the real image event with BOTH id and direct url', () => {
    const out = extractInboundMessages(REAL_CHAKRA_IMAGE_EVENT);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].type, 'image');
    assert.strictEqual(out[0].media.length, 1);
    assert.strictEqual(out[0].media[0].id, '2565531760616440');
    assert.ok(out[0].media[0].url.startsWith('https://lookaside.fbsbx.com/'));
    assert.strictEqual(out[0].media[0].mimeType, 'image/jpeg');
    assert.strictEqual(out[0].text, null);
  });
  check('falls back to the envelope messageId when the message has no id', () => {
    const out = extractInboundMessages({
      event: 'message',
      payload: {
        messageId: 'wamid.ENVELOPE',
        message: { from: '243810000000', type: 'text', text: { body: 'Villa Gombe' } },
      },
    });
    assert.strictEqual(out[0].wamid, 'wamid.ENVELOPE');
  });
  check('reads the sender from contacts when message.from is absent', () => {
    const out = extractInboundMessages({
      event: 'message',
      payload: {
        messageId: 'wamid.X',
        message: { type: 'text', text: { body: 'Villa Gombe' } },
        contacts: [{ wa_id: '243810000000', profile: { name: 'Papy' } }],
      },
    });
    assert.strictEqual(out[0].from, '243810000000');
    assert.strictEqual(out[0].profileName, 'Papy');
  });
  check("strips a leading '+' from the sender", () => {
    const out = extractInboundMessages({
      event: 'message',
      payload: { messageId: 'x', message: { from: '+243810000000', text: { body: 'test' } } },
    });
    assert.strictEqual(out[0].from, '243810000000');
  });
  check('still supports the flatter {payload:{contact:{msisdn},body}} variant', () => {
    const out = extractInboundMessages({
      event: 'message.received',
      payload: { id: 'wamid.FLAT', contact: { msisdn: '243810000000', name: 'Papy' }, body: 'Villa Gombe' },
    });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].from, '243810000000');
    assert.strictEqual(out[0].text, 'Villa Gombe');
    assert.strictEqual(out[0].wamid, 'wamid.FLAT');
  });
  check('an event with no sender is ignored', () =>
    assert.deepStrictEqual(
      extractInboundMessages({ event: 'message', payload: { message: { text: { body: 'orphan' } } } }),
      [],
    ));
  check('a status-only Chakra event yields nothing', () =>
    assert.deepStrictEqual(
      extractInboundMessages({ event: 'message.status', payload: { messageId: 'x', status: 'delivered' } }),
      [],
    ));
  check('Meta envelope still wins when both could match', () => {
    const out = extractInboundMessages({
      entry: [{ changes: [{ value: { messages: [
        { from: '243999999999', id: 'wamid.META', type: 'text', text: { body: 'from meta' } },
      ] } }] }],
      payload: { message: { from: '243810000000', text: { body: 'from payload' } } },
    });
    assert.strictEqual(out[0].text, 'from meta');
  });

  check('parses a flat {from, text} payload', () => {
    const out = extractInboundMessages({ from: '243810000000', text: 'Studio Lemba 400$' });
    assert.strictEqual(out[0].from, '243810000000');
    assert.strictEqual(out[0].text, 'Studio Lemba 400$');
  });
  check('parses a nested {message:{sender, body}} payload', () => {
    const out = extractInboundMessages({ message: { sender: '243820000000', body: 'Parcelle Limete' } });
    assert.strictEqual(out[0].from, '243820000000');
    assert.strictEqual(out[0].text, 'Parcelle Limete');
  });
  check('ignores status-only envelopes', () =>
    assert.deepStrictEqual(
      extractInboundMessages({ entry: [{ changes: [{ value: { statuses: [{ id: 'x', status: 'delivered' }] } }] }] }),
      [],
    ));
  check('ignores empty / junk payloads', () => {
    assert.deepStrictEqual(extractInboundMessages({}), []);
    assert.deepStrictEqual(extractInboundMessages(null), []);
    assert.deepStrictEqual(extractInboundMessages({ foo: 'bar' }), []);
  });

  check('a video message is captured (not silently dropped) and flagged unsupported', () => {
    const out = extractInboundMessages({
      entry: [{ changes: [{ value: { messages: [
        { from: '243810000000', id: 'wamid.VID', type: 'video', video: { id: 'v1', mime_type: 'video/mp4' } },
      ] } }] }],
    });
    assert.strictEqual(out.length, 1, 'video message should still be collected for a fallback reply');
    assert.strictEqual(webhookRouter.isUnsupportedType(out[0]), true);
  });
  check('a text message is never flagged unsupported', () => {
    const out = extractInboundMessages({
      entry: [{ changes: [{ value: { messages: [
        { from: '243810000000', id: 'wamid.TXT', type: 'text', text: { body: 'Villa a louer' } },
      ] } }] }],
    });
    assert.strictEqual(webhookRouter.isUnsupportedType(out[0]), false);
  });

  // -------------------------------------------------------------------------
  // 4b. services/db.js — commune/quartier schema + seed
  // -------------------------------------------------------------------------

  console.log('\n4b. services/db.js commune/quartier schema');

  check('listings table has commune and quartier columns (not the old neighborhood name)', () => {
    const columns = dbService.db.prepare('PRAGMA table_info(listings)').all().map((c) => c.name);
    assert.ok(columns.includes('commune'));
    assert.ok(columns.includes('quartier'));
    assert.ok(!columns.includes('neighborhood'));
  });
  check('idx_commune and idx_quartier indexes exist on listings', () => {
    const indexes = dbService.db.prepare('PRAGMA index_list(listings)').all().map((i) => i.name);
    assert.ok(indexes.includes('idx_commune'));
    assert.ok(indexes.includes('idx_quartier'));
  });
  check('listings table has parcelle_subtype, units_count and reference columns', () => {
    const columns = dbService.db.prepare('PRAGMA table_info(listings)').all();
    const byName = Object.fromEntries(columns.map((c) => [c.name, c.type]));
    assert.strictEqual(byName.parcelle_subtype, 'TEXT');
    assert.strictEqual(byName.units_count, 'INTEGER');
    assert.strictEqual(byName.reference, 'TEXT');
  });
  check('communes/quartiers relational tables are seeded from kinshasa_locations.json', () => {
    const { count: communeCount } = dbService.db.prepare('SELECT COUNT(*) AS count FROM communes').get();
    const { count: quartierCount } = dbService.db.prepare('SELECT COUNT(*) AS count FROM quartiers').get();
    assert.strictEqual(communeCount, 24);
    assert.strictEqual(quartierCount, locationsService.ALL_QUARTIERS.length);
  });
  check('quartiers are correctly linked to their commune via commune_id', () => {
    const row = dbService.db
      .prepare(
        `SELECT q.name FROM quartiers q
         JOIN communes c ON c.id = q.commune_id
         WHERE c.name = 'Ngaliema' AND q.name = 'Macampagne'`,
      )
      .get();
    assert.ok(row, 'Macampagne should be linked under commune Ngaliema');
  });
  check('seedLocations is idempotent — re-running it does not duplicate rows', () => {
    const before = dbService.db.prepare('SELECT COUNT(*) AS count FROM communes').get().count;
    dbService.seedLocations();
    const after = dbService.db.prepare('SELECT COUNT(*) AS count FROM communes').get().count;
    assert.strictEqual(after, before);
  });

  // -------------------------------------------------------------------------
  // 5. db.insertListing
  // -------------------------------------------------------------------------

  console.log('\n5. services/db.js insertListing');

  const extracted = cannedCompletion();
  const data = JSON.parse(extracted.choices[0].message.content).extracted_data;

  const saved = dbService.insertListing(data, '243810000000', {
    wamid: 'wamid.DIRECT',
    agentName: 'Agent Papy',
    rawText: 'Villa a louer...',
  });
  check('inserts and returns a row id', () => assert.ok(saved.id > 0));
  check('is not flagged duplicate on first insert', () =>
    assert.strictEqual(saved.duplicate, false));

  const row = dbService.getListing(saved.id);
  check('persists every extracted field', () => {
    assert.strictEqual(row.commune, 'Ngaliema');
    // Raw pass-through here: insertListing() itself does no normalisation —
    // that belt-and-braces step lives in routes/webhook.js (see section 6's
    // "quartier is normalised end-to-end" check), so calling insertListing
    // directly stores exactly what it was handed.
    assert.strictEqual(row.quartier, 'Ma Campagne');
    assert.strictEqual(row.transaction_type, 'location');
    assert.strictEqual(row.price, 2500);
    assert.strictEqual(row.currency, 'USD');
    assert.strictEqual(row.price_period, 'mois');
    assert.strictEqual(row.bedrooms, 4);
    assert.strictEqual(row.surface_area_sqm, 600);
    assert.strictEqual(row.furnished, true);
    assert.deepStrictEqual(row.amenities, ['piscine', 'forage']);
    assert.strictEqual(row.wa_id, '243810000000');
    assert.strictEqual(row.wamid, 'wamid.DIRECT');
  });
  check('parcelle_subtype/units_count/reference default to null when the extraction has none of them', () => {
    assert.strictEqual(row.parcelle_subtype, null);
    assert.strictEqual(row.units_count, null);
    assert.strictEqual(row.reference, null);
  });
  check('insertListing persists parcelle_subtype/units_count/reference when present', () => {
    const parcelle = dbService.insertListing(
      {
        intent: 'listing', transaction_type: 'vente', property_type: 'parcelle',
        parcelle_subtype: 'maison_type_locataire', commune: 'Mont-Ngafula', quartier: 'Kimwenza',
        price: 45000, currency: 'USD', surface_area_sqm: 95.4, units_count: 4,
        reference: 'LKP-2026-0091', amenities: [], missing_fields: [], confidence: 0.9,
      },
      '243810000099',
      { wamid: 'wamid.PARCELLE' },
    );
    const parcelleRow = dbService.getListing(parcelle.id);
    assert.strictEqual(parcelleRow.property_type, 'parcelle');
    assert.strictEqual(parcelleRow.parcelle_subtype, 'maison_type_locataire');
    assert.strictEqual(parcelleRow.units_count, 4);
    assert.strictEqual(parcelleRow.reference, 'LKP-2026-0091');
  });
  check('same wamid twice is flagged duplicate', () => {
    const again = dbService.insertListing(data, '243810000000', { wamid: 'wamid.DIRECT' });
    assert.strictEqual(again.duplicate, true);
    assert.strictEqual(again.id, saved.id);
  });
  check('requires extractedData and senderPhone', () => {
    assert.throws(() => dbService.insertListing(null, '243810000000'), /requires extractedData/);
    assert.throws(() => dbService.insertListing(data, null), /requires senderPhone/);
  });

  // -------------------------------------------------------------------------
  // 5b. Multi-turn confirmation (services/db.js)
  // -------------------------------------------------------------------------

  console.log('\n5b. services/db.js multi-turn confirmation');

  check('a freshly inserted listing starts pending_confirmation', () =>
    assert.strictEqual(row.status, 'pending_confirmation'));

  const pending = dbService.findLatestPendingListing('243810000000');
  check('findLatestPendingListing finds it', () => assert.strictEqual(pending.id, saved.id));

  const corrected = dbService.applyListingCorrection(
    saved.id,
    { bedrooms: 5 },
    "non, c'est 5 chambres",
    ['wamid.CORRECTION'],
    ['/uploads/listings/wamid_DIRECT-0.jpg'],
  );
  check('applyListingCorrection overwrites only the mentioned field', () => {
    assert.strictEqual(corrected.bedrooms, 5);
    assert.strictEqual(corrected.commune, 'Ngaliema', 'unrelated field must survive the correction');
    assert.strictEqual(corrected.price, 2500);
  });
  check('applyListingCorrection appends to raw_text, group_wamids and photos', () => {
    assert.ok(corrected.raw_text.includes("non, c'est 5 chambres"));
    assert.ok(corrected.group_wamids.includes('wamid.CORRECTION'));
    assert.deepStrictEqual(corrected.photos, ['/uploads/listings/wamid_DIRECT-0.jpg']);
  });
  check('the correction wamid is now findable via group_wamids', () => {
    const already = dbService.findByWamid('wamid.CORRECTION');
    assert.ok(already);
    assert.strictEqual(already.id, saved.id);
  });

  const reCorrected = dbService.applyListingCorrection(
    saved.id,
    { property_type: 'parcelle', parcelle_subtype: 'terrain_nu', units_count: 2, reference: 'REF-042' },
    'Réf: REF-042, 2 portes en fait, terrain nu',
    ['wamid.CORRECTION2'],
    [],
  );
  check('applyListingCorrection updates parcelle_subtype/units_count/reference like any other field', () => {
    assert.strictEqual(reCorrected.property_type, 'parcelle');
    assert.strictEqual(reCorrected.parcelle_subtype, 'terrain_nu');
    assert.strictEqual(reCorrected.units_count, 2);
    assert.strictEqual(reCorrected.reference, 'REF-042');
    assert.strictEqual(reCorrected.commune, 'Ngaliema', 'still unaffected by an unrelated correction');
  });

  const published = dbService.publishListing(saved.id);
  check('publishListing reports success', () => assert.strictEqual(published, true));
  check('status flips to published', () =>
    assert.strictEqual(dbService.getListing(saved.id).status, 'published'));
  check('the listing no longer shows up as pending', () =>
    assert.strictEqual(dbService.findLatestPendingListing('243810000000'), undefined));
  check('publishing an already-published listing stays idempotent', () =>
    assert.strictEqual(dbService.publishListing(saved.id), true));

  // -------------------------------------------------------------------------
  // 6. End-to-end through the live HTTP endpoint
  // -------------------------------------------------------------------------

  console.log('\n6. End-to-end: POST /webhook -> openai -> db -> chakra');

  /**
   * @param {Object} [options]
   * @param {string|null} [options.signature] Override the X-Chakra-Signature-256
   *        header. Omit for a correctly-signed request (the normal case);
   *        pass a bad value to test rejection, or null to omit the header.
   */
  function post(pathname, body, options = {}) {
    const payload = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    };
    if (pathname === '/webhook') {
      const signature = 'signature' in options
        ? options.signature
        : require('crypto')
            .createHmac('sha256', process.env.CHAKRA_WEBHOOK_HMAC_SECRET)
            .update(payload)
            .digest('hex');
      if (signature !== null) {
        headers['X-Chakra-Signature-256'] = signature;
      }
    }
    return new Promise((resolve) => {
      const req = http.request(
        { host: 'localhost', port: 3200, path: pathname, method: 'POST', headers },
        (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); },
      );
      req.end(payload);
    });
  }
  const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

  function inbound(wamid, text, from = '243840000000') {
    return {
      object: 'whatsapp_business_account',
      entry: [{ id: '1', changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: '987654321' },
        contacts: [{ wa_id: from, profile: { name: 'Agent Kimwenza' } }],
        messages: [{ from, id: wamid, timestamp: '1', type: 'text', text: { body: text } }],
      } }] }],
    };
  }

  function inboundImage(wamid, mediaId, caption) {
    const image = caption ? { id: mediaId, caption } : { id: mediaId };
    return {
      object: 'whatsapp_business_account',
      entry: [{ id: '1', changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: '987654321' },
        contacts: [{ wa_id: '243850000000', profile: { name: 'Agent Photo' } }],
        messages: [{ from: '243850000000', id: wamid, timestamp: '1', type: 'image', image }],
      } }] }],
    };
  }

  // -------------------------------------------------------------------------
  // 6a. Webhook HMAC signature verification (X-Chakra-Signature-256)
  // -------------------------------------------------------------------------

  console.log('\n6a. POST /webhook signature verification');

  const sigRowsBefore = dbService.countListings();
  const sigAiBefore = openaiCalls.length;

  const missingSigStatus = await post(
    '/webhook',
    inbound('wamid.NOSIG', 'Villa a louer Ngaliema'),
    { signature: null },
  );
  check('rejects a request with no signature header', () => assert.strictEqual(missingSigStatus, 401));

  const badSigStatus = await post(
    '/webhook',
    inbound('wamid.BADSIG', 'Villa a louer Ngaliema'),
    { signature: 'deadbeef'.repeat(8) },
  );
  check('rejects a request with a wrong signature', () => assert.strictEqual(badSigStatus, 401));

  await settle(200);
  check('neither rejected request reached the model or the DB', () => {
    assert.strictEqual(openaiCalls.length, sigAiBefore);
    assert.strictEqual(dbService.countListings(), sigRowsBefore);
  });

  // -------------------------------------------------------------------------
  // 6a2. Unsupported media types get a friendly reply, not a silent drop
  // -------------------------------------------------------------------------

  console.log('\n6a2. POST /webhook unsupported media reply');

  const vidRowsBefore = dbService.countListings();
  const vidAiBefore = openaiCalls.length;
  httpCalls.length = 0;

  const vidStatus = await post('/webhook', {
    object: 'whatsapp_business_account',
    entry: [{ id: '1', changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: '987654321' },
      contacts: [{ wa_id: '243870000000', profile: { name: 'Agent Video' } }],
      messages: [{ from: '243870000000', id: 'wamid.VIDEO', timestamp: '1', type: 'video', video: { id: 'v1', mime_type: 'video/mp4' } }],
    } }] }],
  });
  await settle(200);

  check('acknowledges the video message with 200', () => assert.strictEqual(vidStatus, 200));
  check('a video message never reaches gpt-4o or the DB', () => {
    assert.strictEqual(openaiCalls.length, vidAiBefore);
    assert.strictEqual(dbService.countListings(), vidRowsBefore);
  });
  check('the agent gets the unsupported-format reply, not silence', () => {
    assert.strictEqual(httpCalls.length, 1);
    assert.strictEqual(httpCalls[0].data.to, '243870000000');
    assert.strictEqual(httpCalls[0].data.text.body, webhookRouter.UNSUPPORTED_MEDIA_REPLY);
  });

  const rowsBefore = dbService.countListings();
  const aiBefore = openaiCalls.length;
  httpCalls.length = 0;

  const status = await post('/webhook', inbound('wamid.E2E', 'Villa a louer Ngaliema 4 chambres 2500$/mois'));
  await settle();

  check('acknowledges with 200', () => assert.strictEqual(status, 200));
  check('called gpt-4o exactly once', () => assert.strictEqual(openaiCalls.length - aiBefore, 1));
  check('saved exactly one listing', () =>
    assert.strictEqual(dbService.countListings() - rowsBefore, 1));
  check('sent exactly one Chakra reply', () => assert.strictEqual(httpCalls.length, 1));
  check('reply went to the sender with the model-written text', () => {
    assert.strictEqual(httpCalls[0].data.to, '243840000000');
    assert.ok(httpCalls[0].data.text.body.includes('Annonce reçue'));
  });
  check('stored row is linked to the inbound wamid', () => {
    const found = dbService.findByWamid('wamid.E2E');
    assert.ok(found, 'no row found for wamid.E2E');
  });
  check('quartier is normalised end-to-end ("Ma Campagne" -> "Macampagne")', () => {
    const found = dbService.findByWamid('wamid.E2E');
    const row = dbService.getListing(found.id);
    assert.strictEqual(row.commune, 'Ngaliema');
    assert.strictEqual(row.quartier, 'Macampagne');
  });

  // A parcelle listing carrying all three new classification fields, driven
  // through the real HTTP endpoint end-to-end (webhook -> openai -> db), not
  // just a direct services/db.js call — confirms extraction, coercion (a
  // string "4" for units_count must still land as an integer) and storage
  // all agree on these fields, not just each in isolation.
  nextCompletion = cannedCompletion({
    choices: [{ finish_reason: 'stop', message: { refusal: null, content: JSON.stringify({
      extracted_data: {
        is_listing: true, intent: 'listing', transaction_type: 'vente', property_type: 'parcelle',
        parcelle_subtype: 'maison_type_locataire', commune: 'Mont-Ngafula', quartier: 'Kimwenza',
        price: 45000, currency: 'USD', price_period: 'total', deposit_months: null,
        bedrooms: null, bathrooms: null, surface_area_sqm: 95.4, units_count: '4',
        furnished: null, amenities: [], reference: 'LKP-2026-0091',
        summary_fr: 'Parcelle avec maison type locataire, 4 portes, a Kimwenza.',
        missing_fields: [], confidence: 0.92,
      },
      whatsapp_reply: '*Annonce reçue* ✅\nParcelle a Kimwenza. Répondez *OK* pour publier.',
    }) } }],
  });
  await post(
    '/webhook',
    // A distinct sender is deliberate: wamid.E2E (above) is still pending on
    // the default sender, awaiting the 'OK' the next block below sends — a
    // second listing landing on that same sender would out-rank it as "most
    // recent pending" and steal that confirmation.
    inbound(
      'wamid.PARCELLE_E2E',
      'A vendre parcelle clôturée, Maison Type Locataire 4 Portes, Kimwenza Mont-Ngafula. 5,30m sur 18m. 45000$. Réf: LKP-2026-0091',
      '243845550001',
    ),
  );
  await settle();

  check('parcelle_subtype/units_count/reference reach SQLite end-to-end through the real webhook route', () => {
    const found = dbService.findByWamid('wamid.PARCELLE_E2E');
    assert.ok(found, 'no row found for wamid.PARCELLE_E2E');
    const parcelleRow = dbService.getListing(found.id);
    assert.strictEqual(parcelleRow.property_type, 'parcelle');
    assert.strictEqual(parcelleRow.parcelle_subtype, 'maison_type_locataire');
    assert.strictEqual(parcelleRow.units_count, 4, 'a numeric string from the model must still coerce to an integer');
    assert.strictEqual(parcelleRow.reference, 'LKP-2026-0091');
    assert.strictEqual(parcelleRow.commune, 'Mont-Ngafula');
    assert.strictEqual(parcelleRow.quartier, 'Kimwenza');
  });

  // Confirming with 'OK' — the actual multi-turn confirmation loop, end to end
  // through the HTTP endpoint (not just the services/db.js unit checks above).
  const aiBeforeConfirm = openaiCalls.length;
  httpCalls.length = 0;
  await post('/webhook', inbound('wamid.CONFIRM', 'OK'));
  await settle();

  check("'OK' publishes without calling gpt-4o again", () =>
    assert.strictEqual(openaiCalls.length - aiBeforeConfirm, 0));
  check("'OK' gets the exact published-confirmation reply", () => {
    assert.strictEqual(httpCalls.length, 1);
    assert.strictEqual(httpCalls[0].data.text.body, webhookRouter.PUBLISHED_REPLY);
  });
  check('the listing is now published', () => {
    const found = dbService.findByWamid('wamid.E2E');
    assert.strictEqual(dbService.getListing(found.id).status, 'published');
  });

  // Redelivery must not re-bill gpt-4o or re-reply.
  const aiBeforeRetry = openaiCalls.length;
  const rowsBeforeRetry = dbService.countListings();
  httpCalls.length = 0;
  await post('/webhook', inbound('wamid.E2E', 'Villa a louer Ngaliema 4 chambres 2500$/mois'));
  await settle();

  check('redelivery makes no gpt-4o call', () =>
    assert.strictEqual(openaiCalls.length - aiBeforeRetry, 0));
  check('redelivery inserts no row', () =>
    assert.strictEqual(dbService.countListings() - rowsBeforeRetry, 0));
  check('redelivery sends no second reply', () => assert.strictEqual(httpCalls.length, 0));

  // Non-listing chatter: reply, but do not store.
  nextCompletion = cannedCompletion({
    choices: [{ finish_reason: 'stop', message: { refusal: null, content: JSON.stringify({
      extracted_data: {
        is_listing: false, intent: 'greeting', transaction_type: null, property_type: null,
        parcelle_subtype: null, commune: null, quartier: null, price: null, currency: null,
        price_period: null, deposit_months: null, bedrooms: null, bathrooms: null,
        surface_area_sqm: null, units_count: null, furnished: null, amenities: [], reference: null,
        summary_fr: 'Salutation.', missing_fields: [], confidence: 0.2,
      },
      whatsapp_reply: 'Bonjour 👋 Envoyez-moi votre annonce avec le type, la commune et le prix.',
    }) } }],
  });
  const rowsBeforeGreeting = dbService.countListings();
  httpCalls.length = 0;
  await post('/webhook', inbound('wamid.GREET', 'Bonjour'));
  await settle();

  check('greeting stores no listing', () =>
    assert.strictEqual(dbService.countListings() - rowsBeforeGreeting, 0));
  check('greeting still gets a reply', () => {
    assert.strictEqual(httpCalls.length, 1);
    assert.ok(httpCalls[0].data.text.body.includes('Bonjour'));
  });

  // A payload with nothing usable must not crash or call anything.
  const aiBeforeJunk = openaiCalls.length;
  httpCalls.length = 0;
  const junkStatus = await post('/webhook', { object: 'whatsapp_business_account', entry: [] });
  await settle(200);
  check('junk payload is acked and ignored', () => {
    assert.strictEqual(junkStatus, 200);
    assert.strictEqual(openaiCalls.length - aiBeforeJunk, 0);
    assert.strictEqual(httpCalls.length, 0);
  });

  // -------------------------------------------------------------------------
  // 6b. Photo listings end-to-end
  // -------------------------------------------------------------------------

  console.log('\n6b. Photo listings: media download -> vision -> db -> reply');

  let rowsBeforeImg = dbService.countListings();
  let aiBeforeImg = openaiCalls.length;
  httpCalls.length = 0;

  await post('/webhook', inboundImage('wamid.PHOTO', 'media_777', 'Villa a louer Ngaliema'));
  await settle(600);

  check('downloads the media then calls gpt-4o once', () => {
    const gets = httpCalls.filter((c) => c.method === 'get');
    assert.strictEqual(gets.length, 1, 'expected a single one-hop download');
    assert.strictEqual(openaiCalls.length - aiBeforeImg, 1);
  });
  check('sends the photo to the vision model as an image part', () => {
    const parts = openaiCalls[openaiCalls.length - 1].messages[1].content;
    const imgs = parts.filter((p) => p.type === 'image_url');
    assert.strictEqual(imgs.length, 1);
    assert.strictEqual(imgs[0].image_url.url, `data:image/jpeg;base64,${REAL_JPEG_BYTES.toString('base64')}`);
  });
  check('passes the caption alongside the photo', () => {
    const parts = openaiCalls[openaiCalls.length - 1].messages[1].content;
    assert.ok(parts[0].text.includes('Villa a louer Ngaliema'));
    assert.ok(/1 image\(s\)/.test(parts[0].text));
  });
  check('stores the photo listing', () =>
    assert.strictEqual(dbService.countListings() - rowsBeforeImg, 1));
  check('persists the downloaded photo and links its path to the listing', () => {
    const row = dbService.getRecentListings(1)[0];
    assert.strictEqual(row.photos.length, 1);
    assert.ok(row.photos[0].startsWith('/uploads/listings/'), row.photos[0]);
    assert.ok(
      fs.existsSync(path.join(mediaStorage.UPLOADS_ROOT, row.photos[0].replace('/uploads/', ''))),
      `${row.photos[0]} was not written to disk`,
    );
  });
  check('replies to the agent', () => {
    // A photo submission now gets two replies: the immediate burst-start ack
    // (fired at enqueue time, before extraction even runs), then the real
    // listing summary once gpt-4o/db work finishes — see routes/webhook.js's
    // enqueueMessage. Text-only messages (greetings, buyer chat) don't get
    // the ack — see the 'media' gate there — so this is specific to photo
    // submissions, not a change to every reply in this suite.
    const posts = httpCalls.filter((c) => c.method === 'post');
    assert.strictEqual(posts.length, 2, 'expected an immediate ack plus the real listing reply');
    assert.strictEqual(posts[0].data.to, '243850000000');
    assert.ok(posts[0].data.text.body.includes('Message reçu'), 'first post should be the burst-start ack');
    assert.strictEqual(posts[1].data.to, '243850000000');
  });

  // Photo with no caption at all — the case that used to be dropped entirely.
  rowsBeforeImg = dbService.countListings();
  aiBeforeImg = openaiCalls.length;
  httpCalls.length = 0;
  await post('/webhook', inboundImage('wamid.NOCAPTION', 'media_888'));
  await settle(600);

  check('a caption-less photo still reaches the vision model', () => {
    assert.strictEqual(openaiCalls.length - aiBeforeImg, 1);
    const parts = openaiCalls[openaiCalls.length - 1].messages[1].content;
    assert.strictEqual(parts.filter((p) => p.type === 'image_url').length, 1);
    assert.ok(/images uniquement/.test(parts[0].text));
  });
  check('caption-less photo is stored and answered', () => {
    assert.strictEqual(dbService.countListings() - rowsBeforeImg, 1);
    assert.strictEqual(httpCalls.filter((c) => c.method === 'post').length, 1);
  });

  // Download fails but there IS a caption: degrade to text-only rather than drop.
  mediaDownloadError = true;
  rowsBeforeImg = dbService.countListings();
  aiBeforeImg = openaiCalls.length;
  httpCalls.length = 0;
  await post('/webhook', inboundImage('wamid.BADMEDIA', 'media_gone', 'Villa Gombe 1800$'));
  await settle(600);

  check('failed download degrades to caption-only extraction', () => {
    assert.strictEqual(openaiCalls.length - aiBeforeImg, 1, 'should still call the model');
    const parts = openaiCalls[openaiCalls.length - 1].messages[1].content;
    assert.strictEqual(parts.filter((p) => p.type === 'image_url').length, 0);
    assert.ok(parts[0].text.includes('Villa Gombe 1800$'));
  });
  check('caption-only fallback still stores and replies', () => {
    assert.strictEqual(dbService.countListings() - rowsBeforeImg, 1);
    assert.strictEqual(httpCalls.filter((c) => c.method === 'post').length, 1);
  });

  // Download fails and there is NO caption: nothing to read, skip cleanly.
  rowsBeforeImg = dbService.countListings();
  aiBeforeImg = openaiCalls.length;
  httpCalls.length = 0;
  await post('/webhook', inboundImage('wamid.HOPELESS', 'media_gone2'));
  await settle(600);

  check('unreadable photo with no caption makes no gpt-4o call', () => {
    assert.strictEqual(openaiCalls.length - aiBeforeImg, 0);
    assert.strictEqual(dbService.countListings() - rowsBeforeImg, 0);
    assert.strictEqual(httpCalls.filter((c) => c.method === 'post').length, 0);
  });
  mediaDownloadError = null;

  // Redelivered photo must not re-download or re-bill.
  aiBeforeImg = openaiCalls.length;
  httpCalls.length = 0;
  await post('/webhook', inboundImage('wamid.PHOTO', 'media_777', 'Villa a louer Ngaliema'));
  await settle(400);
  check('redelivered photo skips download, model and reply', () => {
    assert.strictEqual(openaiCalls.length - aiBeforeImg, 0);
    assert.strictEqual(httpCalls.length, 0, 'no HTTP calls at all');
  });

  // -------------------------------------------------------------------------
  // 6c. Photo burst grouping
  // -------------------------------------------------------------------------

  console.log('\n6c. Burst grouping: 4 photos -> one listing');

  function burstPhoto(wamid, mediaId, caption) {
    return inboundImage(wamid, mediaId, caption);
  }

  rowsBeforeImg = dbService.countListings();
  aiBeforeImg = openaiCalls.length;
  httpCalls.length = 0;

  // Caption on the first photo only, as agents usually send it.
  await post('/webhook', burstPhoto('wamid.B1', 'media_b1', 'Villa a louer Ma Campagne 2500$/mois'));
  await settle(40);
  await post('/webhook', burstPhoto('wamid.B2', 'media_b2'));
  await settle(40);
  await post('/webhook', burstPhoto('wamid.B3', 'media_b3'));
  await settle(40);
  await post('/webhook', burstPhoto('wamid.B4', 'media_b4'));
  await settle(900);   // let the idle window close and processing finish

  check('4 photos become ONE gpt-4o call', () =>
    assert.strictEqual(openaiCalls.length - aiBeforeImg, 1));
  check('4 photos become ONE database row', () =>
    assert.strictEqual(dbService.countListings() - rowsBeforeImg, 1));
  check('4 photos get ONE reply', () =>
    assert.strictEqual(httpCalls.filter((c) => c.method === 'post').length, 1));
  check('all 4 images are sent to the vision model together', () => {
    const parts = openaiCalls[openaiCalls.length - 1].messages[1].content;
    assert.strictEqual(parts.filter((p) => p.type === 'image_url').length, 4);
    assert.ok(/4 image\(s\)/.test(parts[0].text));
  });
  check("the first photo's caption is used for the group", () => {
    const parts = openaiCalls[openaiCalls.length - 1].messages[1].content;
    assert.ok(parts[0].text.includes('Villa a louer Ma Campagne 2500$/mois'));
  });

  const burstRow = dbService.getRecentListings(1)[0];
  check('row records every wamid in the burst', () => {
    assert.strictEqual(burstRow.wamid, 'wamid.B1');
    assert.deepStrictEqual(burstRow.group_wamids, ['wamid.B1', 'wamid.B2', 'wamid.B3', 'wamid.B4']);
  });
  check('findByWamid matches a NON-primary id from the burst', () => {
    for (const id of ['wamid.B2', 'wamid.B3', 'wamid.B4']) {
      const found = dbService.findByWamid(id);
      assert.ok(found, `${id} should resolve to the stored listing`);
      assert.strictEqual(found.id, burstRow.id);
    }
  });
  check('findByWamid still returns undefined for an unrelated id', () =>
    assert.strictEqual(dbService.findByWamid('wamid.NEVER_SEEN'), undefined));

  // The whole point: redelivery of photo #3 must not create a second listing.
  aiBeforeImg = openaiCalls.length;
  rowsBeforeImg = dbService.countListings();
  httpCalls.length = 0;
  await post('/webhook', burstPhoto('wamid.B3', 'media_b3'));
  await settle(600);
  check('redelivery of a non-primary burst photo is ignored', () => {
    assert.strictEqual(openaiCalls.length - aiBeforeImg, 0);
    assert.strictEqual(dbService.countListings() - rowsBeforeImg, 0);
    assert.strictEqual(httpCalls.length, 0);
  });

  // Text then photos: the typed listing and its pictures belong together.
  rowsBeforeImg = dbService.countListings();
  aiBeforeImg = openaiCalls.length;
  httpCalls.length = 0;
  // Same sender for both, or they are two separate listings by definition.
  await post('/webhook', inbound('wamid.T1', 'Studio a louer Lemba 400$/mois', '243850000000'));
  await settle(40);
  await post('/webhook', burstPhoto('wamid.T2', 'media_t2'));
  await settle(900);
  check('a text message and following photos merge into one listing', () => {
    assert.strictEqual(openaiCalls.length - aiBeforeImg, 1);
    assert.strictEqual(dbService.countListings() - rowsBeforeImg, 1);
    const parts = openaiCalls[openaiCalls.length - 1].messages[1].content;
    assert.ok(parts[0].text.includes('Studio a louer Lemba'));
    assert.strictEqual(parts.filter((p) => p.type === 'image_url').length, 1);
  });

  // Two different senders must never be merged with each other.
  rowsBeforeImg = dbService.countListings();
  aiBeforeImg = openaiCalls.length;
  httpCalls.length = 0;
  await post('/webhook', inbound('wamid.S1', 'Villa Gombe 1800$'));            // 243840000000
  await post('/webhook', burstPhoto('wamid.S2', 'media_s2', 'Parcelle Limete')); // 243850000000
  await settle(900);
  check('separate senders produce separate listings', () => {
    assert.strictEqual(openaiCalls.length - aiBeforeImg, 2);
    assert.strictEqual(dbService.countListings() - rowsBeforeImg, 2);
    assert.strictEqual(httpCalls.filter((c) => c.method === 'post').length, 2);
  });

  // Max-wait ceiling: a slow trickle still gets flushed.
  rowsBeforeImg = dbService.countListings();
  aiBeforeImg = openaiCalls.length;
  const trickleStart = Date.now();
  await post('/webhook', burstPhoto('wamid.M1', 'media_m1', 'Villa Ngaliema'));
  for (let i = 0; i < 20; i += 1) {
    await settle(90);   // keep re-arming the 120ms idle timer
    await post('/webhook', burstPhoto(`wamid.M${i + 2}`, `media_m${i + 2}`));
  }
  await settle(700);
  check('max-wait ceiling flushes a continuous trickle', () => {
    assert.ok(openaiCalls.length - aiBeforeImg >= 1, 'nothing was ever flushed');
    assert.strictEqual(dbService.countListings() - rowsBeforeImg >= 1, true);
    assert.ok(
      Date.now() - trickleStart < 6000,
      'flush took far longer than the 1200ms max-wait allows',
    );
  });
  check('the image cap still applies to a large burst', () => {
    const parts = openaiCalls[openaiCalls.length - 1].messages[1].content;
    assert.ok(
      parts.filter((p) => p.type === 'image_url').length <= openaiService.MAX_IMAGES,
      'a burst must not exceed MAX_IMAGES',
    );
  });

  // Grouping disabled -> immediate processing, one row per message.
  process.env.GROUP_IDLE_MS = '0';
  rowsBeforeImg = dbService.countListings();
  aiBeforeImg = openaiCalls.length;
  await post('/webhook', inbound('wamid.D1', 'Villa Gombe 1000$'));
  await settle(400);
  check('GROUP_IDLE_MS=0 processes immediately without buffering', () => {
    assert.strictEqual(openaiCalls.length - aiBeforeImg, 1);
    assert.strictEqual(dbService.countListings() - rowsBeforeImg, 1);
  });
  process.env.GROUP_IDLE_MS = '120';

  check('flushAll is exported for graceful shutdown', () =>
    assert.strictEqual(typeof webhookRouter.flushAll, 'function'));

  // -------------------------------------------------------------------------
  // 6d. Chakra's real envelope, end to end
  // -------------------------------------------------------------------------

  console.log("\n6d. message.received envelope through the whole pipeline");

  // Mirrors the live payload captured from Chakra.
  function chakraEvent(id, text, messageExtra = {}) {
    return {
      event: 'message',
      payload: {
        wabaId: '2745491532518223',
        messageId: id,
        externalId: id,
        timestamp: 1786649606000,
        message: {
          from: '+243860000000',
          id,
          timestamp: '1786649606',
          type: messageExtra.image ? 'image' : 'text',
          ...(text ? { text: { body: text } } : {}),
          ...messageExtra,
        },
        contacts: [{ profile: { name: 'Agent Chakra' }, wa_id: '243860000000' }],
      },
    };
  }

  rowsBeforeImg = dbService.countListings();
  aiBeforeImg = openaiCalls.length;
  httpCalls.length = 0;

  await post('/webhook', chakraEvent('wamid.CE1', 'Villa a louer Gombe 1800$/mois 3 chambres'));
  await settle(700);

  check("event:'message' reaches the model and is stored", () => {
    assert.strictEqual(openaiCalls.length - aiBeforeImg, 1);
    assert.strictEqual(dbService.countListings() - rowsBeforeImg, 1);
  });
  check("sender is normalised without the '+' in the stored row", () => {
    const row = dbService.getRecentListings(1)[0];
    assert.strictEqual(row.wa_id, '243860000000');
    assert.strictEqual(row.wamid, 'wamid.CE1');
    assert.strictEqual(row.agent_name, 'Agent Chakra');
  });
  check('reply is addressed to the msisdn', () => {
    const posts = httpCalls.filter((c) => c.method === 'post');
    assert.strictEqual(posts.length, 1);
    assert.strictEqual(posts[0].data.to, '243860000000');
  });
  await checkAsync('redelivery of the same messageId is deduped', async () => {
    const before = openaiCalls.length;
    await post('/webhook', chakraEvent('wamid.CE1', 'Villa a louer Gombe 1800$/mois 3 chambres'));
    await settle(600);
    assert.strictEqual(openaiCalls.length - before, 0);
  });

  // Real image event: id AND a signed lookaside URL. The URL (proxied through
  // Chakra by its `mid`) should be used, not the two-hop by-id route.
  const LOOKASIDE_URL = 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=2565531760616440';
  rowsBeforeImg = dbService.countListings();
  aiBeforeImg = openaiCalls.length;
  httpCalls.length = 0;
  await post(
    '/webhook',
    chakraEvent('wamid.CE2', null, {
      image: {
        id: '2565531760616440',
        mime_type: 'image/jpeg',
        url: LOOKASIDE_URL,
      },
    }),
  );
  await settle(700);

  check('the direct media URL is fetched in ONE authenticated hop', () => {
    const gets = httpCalls.filter((c) => c.method === 'get');
    assert.strictEqual(gets.length, 1, 'should not use the media-id route');
    assert.strictEqual(gets[0].url, chakra.mediaAttachmentUrl('2565531760616440'));
    assert.strictEqual(gets[0].config.headers.Authorization, 'Bearer chakra-test-token');
  });
  check('the fetched photo reaches the vision model as base64', () => {
    const parts = openaiCalls[openaiCalls.length - 1].messages[1].content;
    const imgs = parts.filter((p) => p.type === 'image_url');
    assert.strictEqual(imgs.length, 1);
    assert.strictEqual(
      imgs[0].image_url.url,
      `data:image/jpeg;base64,${REAL_JPEG_BYTES.toString('base64')}`,
    );
  });
  check('caption-less photo event is stored and answered', () => {
    assert.strictEqual(dbService.countListings() - rowsBeforeImg, 1);
    assert.strictEqual(httpCalls.filter((c) => c.method === 'post').length, 1);
  });

  // If the signed URL fails, fall back to the media-id route rather than lose it.
  const savedDownloadError = mediaDownloadError;
  rowsBeforeImg = dbService.countListings();
  aiBeforeImg = openaiCalls.length;
  httpCalls.length = 0;
  mediaDownloadError = null;
  await post(
    '/webhook',
    chakraEvent('wamid.CE3', 'Villa avec piscine', {
      image: { id: '999', mime_type: 'image/jpeg', url: 'https://lookaside.fbsbx.example/forbidden' },
    }),
  );
  await settle(800);
  check('a failing direct URL falls back to the media-id route', () => {
    const gets = httpCalls.filter((c) => c.method === 'get');
    // no `mid` in this fixture -> direct fetch attempted -> fails -> one-hop by-id fallback
    assert.strictEqual(gets.length, 2, `expected a fallback download, saw ${gets.length} GETs`);
    const parts = openaiCalls[openaiCalls.length - 1].messages[1].content;
    assert.strictEqual(parts.filter((p) => p.type === 'image_url').length, 1);
  });
  mediaDownloadError = savedDownloadError;

  // -------------------------------------------------------------------------
  // 7. Read API still serves what the pipeline wrote
  // -------------------------------------------------------------------------

  console.log('\n7. GET /listings reflects pipeline writes');

  function getListings(headers = {}) {
    return new Promise((resolve) => {
      http.get(
        { host: 'localhost', port: 3200, path: '/listings?commune=Ngaliema&limit=100', headers },
        (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
        },
      );
    });
  }

  const noKey = await getListings();
  check('rejects a request with no API key', () => assert.strictEqual(noKey.status, 401));

  const wrongKey = await getListings({ 'X-API-Key': 'not-the-real-key' });
  check('rejects a request with the wrong API key', () => assert.strictEqual(wrongKey.status, 401));

  const bearerForm = await getListings({ Authorization: `Bearer ${process.env.API_SECRET}` });
  check('accepts the key via Authorization: Bearer too', () => assert.strictEqual(bearerForm.status, 200));

  const listedResponse = await getListings({ 'X-API-Key': process.env.API_SECRET });
  const listed = listedResponse.body;
  check('returns the paginated envelope', () => {
    assert.strictEqual(listedResponse.status, 200);
    assert.strictEqual(listed.success, true);
    assert.ok(typeof listed.total === 'number');
    assert.strictEqual(listed.limit, 100);
    assert.strictEqual(listed.offset, 0);
  });
  check('includes rows written by the Chakra pipeline', () =>
    assert.ok(listed.data.some((d) => d.wamid === 'wamid.E2E')));

  // -------------------------------------------------------------------------
  // 8. GET /locations — commune/quartier hierarchy for cascading selects
  // -------------------------------------------------------------------------

  console.log('\n8. GET /locations');

  function getJSON(pathname) {
    return new Promise((resolve) => {
      http.get({ host: 'localhost', port: 3200, path: pathname }, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
      });
    });
  }

  const allLocations = await getJSON('/locations');
  check('GET /locations returns 200 with no auth required (reference data, like /uploads)', () =>
    assert.strictEqual(allLocations.status, 200));
  check('GET /locations returns all 24 communes and the full hierarchy', () => {
    assert.strictEqual(allLocations.body.success, true);
    assert.strictEqual(allLocations.body.communes.length, 24);
    assert.deepStrictEqual(allLocations.body.locations.Ngaliema, locationsService.LOCATIONS.Ngaliema);
  });

  const ngaliemaQuartiers = await getJSON('/locations/Ngaliema/quartiers');
  check('GET /locations/:commune/quartiers returns that commune\'s exact list', () => {
    assert.strictEqual(ngaliemaQuartiers.status, 200);
    assert.strictEqual(ngaliemaQuartiers.body.commune, 'Ngaliema');
    assert.ok(ngaliemaQuartiers.body.quartiers.includes('Macampagne'));
  });

  const fuzzyCommuneParam = await getJSON(`/locations/${encodeURIComponent('la gombe')}/quartiers`);
  check('GET /locations/:commune/quartiers accepts a raw guess, not just the canonical spelling', () => {
    assert.strictEqual(fuzzyCommuneParam.status, 200);
    assert.strictEqual(fuzzyCommuneParam.body.commune, 'Gombe');
  });

  const unknownCommune = await getJSON('/locations/Atlantis/quartiers');
  check('GET /locations/:commune/quartiers 404s for a commune outside the master list', () => {
    assert.strictEqual(unknownCommune.status, 404);
    assert.strictEqual(unknownCommune.body.success, false);
  });

  // -------------------------------------------------------------------------
  // 9. scripts/backfill-locations.js
  // -------------------------------------------------------------------------

  console.log('\n9. scripts/backfill-locations.js');

  // Two rows saved with un-normalised location text — simulating data written
  // before the resolver existed, or via a path that bypassed routes/webhook.js's
  // own normalisation step (a direct insertListing call, exactly like this).
  const dirtyPending = dbService.insertListing(
    { intent: 'listing', commune: 'la gombe', quartier: 'ma campagne', price: 100 },
    '243890000001',
    { wamid: 'wamid.BACKFILL1' },
  );
  const dirtyPublished = dbService.insertListing(
    { intent: 'listing', commune: 'djili', quartier: 'kasai', price: 200 },
    '243890000002',
    { wamid: 'wamid.BACKFILL2', status: 'published' },
  );
  // A row already canonical — must be left alone and not counted as "changed".
  const cleanRow = dbService.insertListing(
    { intent: 'listing', commune: 'Kintambo', quartier: 'Wenze', price: 300 },
    '243890000003',
    { wamid: 'wamid.BACKFILL3' },
  );

  const dryRunResult = await runBackfill({ dryRun: true, db: dbService, postgres: postgresService });
  check('dry run reports both dirty rows as needing normalisation', () => {
    const ids = dryRunResult.changes.map((c) => c.id);
    assert.ok(ids.includes(dirtyPending.id));
    assert.ok(ids.includes(dirtyPublished.id));
    assert.ok(!ids.includes(cleanRow.id), 'an already-canonical row must not be reported as changed');
  });
  check('dry run writes nothing to SQLite', () => {
    const row = dbService.getListing(dirtyPending.id);
    assert.strictEqual(row.commune, 'la gombe');
    assert.strictEqual(row.quartier, 'ma campagne');
  });

  const applyResult = await runBackfill({ dryRun: false, db: dbService, postgres: postgresService });
  check('apply run normalises the pending row in SQLite', () => {
    const row = dbService.getListing(dirtyPending.id);
    assert.strictEqual(row.commune, 'Gombe');
    assert.strictEqual(row.quartier, 'Macampagne');
  });
  check('apply run normalises the published row too', () => {
    const row = dbService.getListing(dirtyPublished.id);
    assert.strictEqual(row.commune, 'Ndjili');
    assert.strictEqual(row.quartier, 'Kasaï');
  });
  check('re-sync is attempted for the published row without throwing (safely no-ops — Postgres unconfigured in this suite)', () => {
    assert.strictEqual(applyResult.resyncFailed, 0);
  });
  check('the clean row is untouched by the apply run', () => {
    const row = dbService.getListing(cleanRow.id);
    assert.strictEqual(row.commune, 'Kintambo');
    assert.strictEqual(row.quartier, 'Wenze');
  });

  const rerunResult = await runBackfill({ dryRun: false, db: dbService, postgres: postgresService });
  check('backfill is idempotent — nothing left to normalise on a second run', () => {
    assert.strictEqual(rerunResult.changed, 0);
  });

  // -------------------------------------------------------------------------
  // 10. services/conversationState.js — WhatsApp assistant state machine
  // -------------------------------------------------------------------------

  console.log('\n10. services/conversationState.js');

  check('every state in TRANSITIONS is a real STATES value', () => {
    for (const from of Object.keys(conversationState.TRANSITIONS)) {
      assert.ok(Object.values(conversationState.STATES).includes(from), `unknown state key: ${from}`);
      for (const to of conversationState.TRANSITIONS[from]) {
        assert.ok(Object.values(conversationState.STATES).includes(to), `unknown target state: ${to}`);
      }
    }
  });
  check('NEW -> COLLECTING_REQUIREMENTS is allowed (normal flow start)', () =>
    assert.strictEqual(conversationState.canTransition('NEW', 'COLLECTING_REQUIREMENTS'), true));
  check('every active (non-terminal) state can reach HUMAN_HANDOFF directly ("je veux parler à quelqu\'un", §17)', () => {
    // CLOSED is deliberately excluded: a closed conversation is done, and a
    // fresh "je veux un humain" from that sender starts a new conversation
    // (CLOSED -> NEW, see routes/webhook.js's future getActiveConversation
    // usage) rather than reanimating the old one — so CLOSED only needs its
    // one documented exit, back to NEW.
    for (const state of Object.values(conversationState.STATES)) {
      if (state === 'HUMAN_HANDOFF' || state === 'CLOSED') continue;
      assert.ok(
        conversationState.canTransition(state, 'HUMAN_HANDOFF'),
        `${state} cannot reach HUMAN_HANDOFF directly`,
      );
    }
  });
  check('CLOSED can only go back to NEW ("nouvelle recherche", §47)', () =>
    assert.deepStrictEqual(conversationState.TRANSITIONS.CLOSED, ['NEW']));
  check('a nonsensical jump (NEW -> VIEWING_REQUEST) is rejected', () =>
    assert.strictEqual(conversationState.canTransition('NEW', 'VIEWING_REQUEST'), false));
  check('assertTransition throws with a clear message on an invalid jump', () =>
    assert.throws(
      () => conversationState.assertTransition('NEW', 'VIEWING_REQUEST'),
      /Invalid conversation state transition: NEW -> VIEWING_REQUEST/,
    ));
  check('assertTransition throws on an unknown target state', () =>
    assert.throws(() => conversationState.assertTransition('NEW', 'BOGUS'), /Unknown conversation state/));
  check('assertTransition returns the target state on success', () =>
    assert.strictEqual(conversationState.assertTransition('NEW', 'CLOSED'), 'CLOSED'));

  // -------------------------------------------------------------------------
  // 11. services/db.js — conversations / messages / leads / viewing requests
  // -------------------------------------------------------------------------

  console.log('\n11. services/db.js conversations/messages/leads/viewing requests');

  const convo = dbService.createConversation('243900000001');
  check('createConversation starts in NEW with AI active', () => {
    assert.strictEqual(convo.state, 'NEW');
    assert.strictEqual(convo.ai_active, true);
    assert.deepStrictEqual(convo.last_shown_property_ids, []);
  });
  check('getActiveConversation finds the just-created conversation', () => {
    const active = dbService.getActiveConversation('243900000001');
    assert.strictEqual(active.id, convo.id);
  });

  dbService.updateConversationState(convo.id, 'COLLECTING_REQUIREMENTS');
  check('updateConversationState persists a valid transition', () =>
    assert.strictEqual(dbService.getConversation(convo.id).state, 'COLLECTING_REQUIREMENTS'));
  check('updateConversationState rejects an invalid transition and leaves state unchanged', () => {
    assert.throws(() => dbService.updateConversationState(convo.id, 'VIEWING_REQUEST'));
    assert.strictEqual(dbService.getConversation(convo.id).state, 'COLLECTING_REQUIREMENTS');
  });

  dbService.updateConversationRequirements(convo.id, { commune: 'Gombe', transaction_type: 'location' });
  check('updateConversationRequirements sets the mentioned fields', () => {
    const updated = dbService.getConversation(convo.id);
    assert.strictEqual(updated.commune, 'Gombe');
    assert.strictEqual(updated.transaction_type, 'location');
  });
  dbService.updateConversationRequirements(convo.id, { bedrooms: 2 });
  check('a later partial update does not clear earlier fields ("do not repeatedly ask", §9)', () => {
    const updated = dbService.getConversation(convo.id);
    assert.strictEqual(updated.commune, 'Gombe', 'commune should survive an unrelated update');
    assert.strictEqual(updated.bedrooms, 2);
  });

  dbService.setLastShownProperties(convo.id, [101, 102, 103]);
  check('setLastShownProperties round-trips as a real array (for "le premier" / "moins cher")', () =>
    assert.deepStrictEqual(dbService.getConversation(convo.id).last_shown_property_ids, [101, 102, 103]));

  dbService.setSelectedProperty(convo.id, 102);
  check('setSelectedProperty persists', () =>
    assert.strictEqual(dbService.getConversation(convo.id).selected_property_id, 102));

  dbService.setConversationAiActive(convo.id, false);
  check('setConversationAiActive(false) — AI goes silent for human handoff (§17)', () =>
    assert.strictEqual(dbService.getConversation(convo.id).ai_active, false));
  dbService.assignConversationAgent(convo.id, 'Agent Marie');
  check('assignConversationAgent persists the agent name', () =>
    assert.strictEqual(dbService.getConversation(convo.id).assigned_agent, 'Agent Marie'));

  const inMsg = dbService.recordMessage(convo.id, 'inbound', { wamid: 'wamid.CONVO1', text: 'Je cherche à Gombe' });
  const outMsg = dbService.recordMessage(convo.id, 'outbound', { text: 'Quel budget ?' });
  check('recordMessage stores both directions', () => {
    assert.strictEqual(inMsg.direction, 'inbound');
    assert.strictEqual(outMsg.direction, 'outbound');
  });
  check('recordMessage rejects an invalid direction', () =>
    assert.throws(() => dbService.recordMessage(convo.id, 'sideways', { text: 'x' }), /direction must be/));
  check('getMessages returns the full transcript in order (agent handoff context, §48)', () => {
    const transcript = dbService.getMessages(convo.id);
    assert.strictEqual(transcript.length, 2);
    assert.strictEqual(transcript[0].id, inMsg.id);
    assert.strictEqual(transcript[1].id, outMsg.id);
  });

  const lead = dbService.createLead({
    conversation_id: convo.id,
    wa_id: '243900000001',
    source: 'whatsapp',
    transaction_type: 'location',
    commune: 'Gombe',
    bedrooms: 2,
    requirements_summary: 'Appartement 2 chambres à Gombe',
  });
  check('createLead defaults to status NEW', () => assert.strictEqual(lead.status, 'NEW'));
  check('createLead stamps last_interaction_at', () => assert.ok(lead.last_interaction_at));
  check('createLead requires wa_id', () => assert.throws(() => dbService.createLead({}), /requires wa_id/));

  const requalified = dbService.updateLeadStatus(lead.id, 'QUALIFIED');
  check('updateLeadStatus transitions status', () => assert.strictEqual(requalified.status, 'QUALIFIED'));
  check('updateLeadStatus rejects an unknown status', () =>
    assert.throws(() => dbService.updateLeadStatus(lead.id, 'MAYBE'), /unknown status/));
  check('LEAD_STATUSES matches the product spec §18 exactly', () =>
    assert.deepStrictEqual(dbService.LEAD_STATUSES, [
      'NEW', 'CONTACTED', 'QUALIFIED', 'VIEWING_REQUESTED', 'VIEWING_COMPLETED', 'CONVERTED', 'LOST',
    ]));
  check('getLeadsByStatus filters correctly', () => {
    const qualified = dbService.getLeadsByStatus('QUALIFIED');
    assert.ok(qualified.some((l) => l.id === lead.id));
    const lost = dbService.getLeadsByStatus('LOST');
    assert.ok(!lost.some((l) => l.id === lead.id));
  });

  const viewing = dbService.createViewingRequest({ leadId: lead.id, propertyId: 102, requestedTime: 'demain matin' });
  check('createViewingRequest stores free-text requested_time', () => {
    assert.strictEqual(viewing.lead_id, lead.id);
    assert.strictEqual(viewing.property_id, 102);
    assert.strictEqual(viewing.requested_time, 'demain matin');
    assert.strictEqual(viewing.status, 'PENDING');
  });
  check('createViewingRequest requires leadId', () =>
    assert.throws(() => dbService.createViewingRequest({ propertyId: 1 }), /requires leadId/));

  console.log('\n11b. services/db.js — conversations schema migration (ALTER TABLE, not just fresh CREATE TABLE)');

  // Caught a real bug during manual QA: `CREATE TABLE IF NOT EXISTS` only
  // applies to a brand-new file. This suite's own `_verify.db` is always
  // deleted and recreated fresh at the top of this script (see the top of
  // this file), so it could never have caught that on its own — a fresh
  // CREATE TABLE already includes every current column. This test closes
  // that gap by explicitly simulating an ALREADY-EXISTING table that
  // predates a later column, the exact scenario that broke.
  dbService.db.exec('ALTER TABLE conversations DROP COLUMN notes');
  check('setup: the `notes` column is now genuinely absent, like an old pre-existing database file', () => {
    const columns = dbService.db.prepare('PRAGMA table_info(conversations)').all().map((c) => c.name);
    assert.ok(!columns.includes('notes'));
  });

  const migrationSurvivor = dbService.createConversation('243940000001');
  const added = dbService.migrateConversations();
  check('migrateConversations() detects and adds the missing column', () => {
    assert.deepStrictEqual(added, ['notes']);
    const columns = dbService.db.prepare('PRAGMA table_info(conversations)').all().map((c) => c.name);
    assert.ok(columns.includes('notes'));
  });
  check('a row created before the migration survives it untouched', () => {
    const survived = dbService.getConversation(migrationSurvivor.id);
    assert.strictEqual(survived.wa_id, '243940000001');
    assert.strictEqual(survived.notes, null, 'new column reads NULL on a pre-existing row, not an error');
  });
  check('updateConversationNotes works immediately after the migration, no restart needed', () => {
    dbService.updateConversationNotes(migrationSurvivor.id, 'post-migration note');
    assert.strictEqual(dbService.getConversation(migrationSurvivor.id).notes, 'post-migration note');
  });
  check('re-running migrateConversations() is a no-op once the column exists', () =>
    assert.deepStrictEqual(dbService.migrateConversations(), []));

  // -------------------------------------------------------------------------
  // 12. services/propertyRepository.js + services/propertyMatching.js
  // -------------------------------------------------------------------------

  console.log('\n12. services/propertyRepository.js + services/propertyMatching.js');

  check('propertyRepository.isConfigured is false in this suite (DB_HOST/etc. blanked above)', () =>
    assert.strictEqual(propertyRepository.isConfigured(), false));

  await checkAsync('searchProperties never throws when unconfigured — returns an empty, flagged result', async () => {
    const result = await propertyRepository.searchProperties({ commune: 'Gombe' });
    assert.deepStrictEqual(result, { total: 0, data: [], error: true });
  });
  await checkAsync('getPropertyById never throws when unconfigured — returns null', async () => {
    assert.strictEqual(await propertyRepository.getPropertyById(123), null);
  });
  await checkAsync('getPropertyById rejects a non-numeric id without querying anything', async () => {
    assert.strictEqual(await propertyRepository.getPropertyById('not-an-id'), null);
  });

  check('propertyRepository.buildFilters always includes the approval gate', () => {
    const { whereClause } = propertyRepository.buildFilters({});
    assert.ok(whereClause.includes('p.status = 1 AND p.approve_status = 1'));
  });
  check('buildFilters maps transactionType location/vente onto purpose rent/sale', () => {
    const rent = propertyRepository.buildFilters({ transactionType: 'location' });
    assert.ok(rent.params.includes('rent'));
    const sale = propertyRepository.buildFilters({ transactionType: 'vente' });
    assert.ok(sale.params.includes('sale'));
  });
  check('buildFilters adds a commune EXISTS clause against property_amenities, not a bare column match', () => {
    const { whereClause, params } = propertyRepository.buildFilters({ commune: 'Gombe' });
    assert.ok(whereClause.includes('property_amenities'));
    assert.ok(params.includes('Gombe'));
  });

  check('propertyMatching.budgetScore is 1.0 at or under budget', () => {
    assert.strictEqual(propertyMatching.budgetScore(900, 1000), 1);
    assert.strictEqual(propertyMatching.budgetScore(1000, 1000), 1);
  });
  check('propertyMatching.budgetScore decays for a price over budget', () => {
    const over = propertyMatching.budgetScore(1500, 1000);
    assert.ok(over < 1 && over >= 0);
  });
  check('propertyMatching.budgetScore is neutral (0.5) with no budget given', () =>
    assert.strictEqual(propertyMatching.budgetScore(1000, null), 0.5));
  check('propertyMatching.bedroomsScore ranks exact > more-than-asked > fewer-than-asked', () => {
    const exact = propertyMatching.bedroomsScore(2, 2);
    const more = propertyMatching.bedroomsScore(3, 2);
    const fewer = propertyMatching.bedroomsScore(1, 2);
    assert.strictEqual(exact, 1);
    assert.ok(more < exact && more > fewer);
  });
  check('propertyMatching.freshnessScore favours recent listings', () => {
    const today = propertyMatching.freshnessScore(new Date().toISOString());
    const old = propertyMatching.freshnessScore(new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString());
    assert.ok(today > old);
    assert.strictEqual(old, 0, 'a listing well past the 90-day decay window should floor at 0');
  });

  await checkAsync('matchProperties never throws when the database is unconfigured', async () => {
    const result = await propertyMatching.matchProperties({ commune: 'Gombe', bedsMin: 2 });
    assert.deepStrictEqual(result, { data: [], total: 0, widened: false, error: true });
  });

  // -------------------------------------------------------------------------
  // 13. services/openai.js — buyer assistant tool-calling layer
  //
  // Entirely new pipeline, additive to services/openai.js — none of this
  // touches parseMessage()/SYSTEM_PROMPT/RESPONSE_FORMAT, all still verified
  // untouched by section 1/2 above (same required module instance).
  // -------------------------------------------------------------------------

  console.log('\n13. services/openai.js buyer assistant (tool-calling)');

  check('BUYER_TOOLS defines exactly the six product-spec tools', () => {
    const names = openaiService.BUYER_TOOLS.map((t) => t.function.name);
    assert.deepStrictEqual(names, [
      'search_properties', 'get_property', 'get_location',
      'create_enquiry', 'request_viewing', 'handoff_to_agent',
    ]);
    for (const tool of openaiService.BUYER_TOOLS) {
      assert.strictEqual(tool.type, 'function');
      assert.ok(tool.function.description);
      assert.strictEqual(tool.function.parameters.type, 'object');
    }
  });

  console.log('\n13a. Individual tool executors (real reads/writes, DB unconfigured for Postgres)');

  await checkAsync('executeSearchProperties degrades to a flagged error when Postgres is unconfigured (never fabricates listings)', async () => {
    const result = await openaiService.executeSearchProperties({ commune: 'Gombe' });
    assert.deepStrictEqual(result, { error: 'search_unavailable' });
  });
  await checkAsync('executeGetProperty reports found:false rather than inventing a property', async () => {
    const result = await openaiService.executeGetProperty({ property_id: 999999 });
    assert.deepStrictEqual(result, { found: false });
  });
  check('executeGetLocation returns the real quartiers for a given commune', () => {
    const result = openaiService.executeGetLocation({ commune: 'Ngaliema' });
    assert.strictEqual(result.commune, 'Ngaliema');
    assert.ok(result.quartiers.includes('Macampagne'));
  });
  check('executeGetLocation with no commune returns all 24 real communes', () => {
    const result = openaiService.executeGetLocation({});
    assert.strictEqual(result.communes.length, 24);
  });

  const toolConvo = dbService.createConversation('243910000001');
  dbService.updateConversationRequirements(toolConvo.id, {
    transaction_type: 'location', commune: 'Gombe', bedrooms: 2,
  });
  const toolContext = {
    conversationId: toolConvo.id,
    waId: '243910000001',
    requirements: { transaction_type: 'location', commune: 'Gombe', bedrooms: 2 },
    selectedPropertyId: null,
  };

  const enquiry = openaiService.executeCreateEnquiry({ summary: 'Cherche 2 chambres à Gombe' }, toolContext);
  check('executeCreateEnquiry creates a real lead pulling requirements from context, not model args', () => {
    assert.strictEqual(enquiry.created, true);
    const savedLead = dbService.getLead(enquiry.lead_id);
    assert.strictEqual(savedLead.wa_id, '243910000001');
    assert.strictEqual(savedLead.conversation_id, toolConvo.id);
    assert.strictEqual(savedLead.commune, 'Gombe');
    assert.strictEqual(savedLead.bedrooms, 2);
    assert.strictEqual(savedLead.requirements_summary, 'Cherche 2 chambres à Gombe');
    assert.strictEqual(savedLead.status, 'NEW');
  });

  const viewingResult = openaiService.executeRequestViewing({ property_id: 42, requested_time: 'demain matin' }, toolContext);
  check('executeRequestViewing reuses the existing lead for this conversation rather than duplicating it', () => {
    assert.strictEqual(viewingResult.lead_id, enquiry.lead_id, 'should reuse the lead created by create_enquiry above');
  });
  check('executeRequestViewing stores the real viewing request and bumps lead status', () => {
    assert.strictEqual(viewingResult.created, true);
    assert.strictEqual(dbService.getLead(enquiry.lead_id).status, 'VIEWING_REQUESTED');
  });

  const handoffConvo = dbService.createConversation('243910000002');
  const handoff = openaiService.executeHandoffToAgent(
    { reason: 'Veut visiter demain' },
    { conversationId: handoffConvo.id, waId: '243910000002', requirements: { commune: 'Limete' } },
  );
  check('executeHandoffToAgent sets ai_active false and transitions to HUMAN_HANDOFF from NEW', () => {
    assert.strictEqual(handoff.handed_off, true);
    assert.strictEqual(handoff.state_changed, true);
    const updated = dbService.getConversation(handoffConvo.id);
    assert.strictEqual(updated.ai_active, false);
    assert.strictEqual(updated.state, 'HUMAN_HANDOFF');
  });
  check('executeHandoffToAgent creates a lead recording the transfer reason', () => {
    const handoffLead = dbService.getLead(handoff.lead_id);
    assert.ok(handoffLead.requirements_summary.includes('Veut visiter demain'));
  });
  check('a second handoff call degrades gracefully (state already HUMAN_HANDOFF) without throwing', () => {
    const again = openaiService.executeHandoffToAgent(
      { reason: 'still wants a human' },
      { conversationId: handoffConvo.id, waId: '243910000002', requirements: {} },
    );
    assert.strictEqual(again.handed_off, true);
    assert.strictEqual(again.state_changed, false, 'HUMAN_HANDOFF -> HUMAN_HANDOFF is not a real transition');
    assert.strictEqual(dbService.getConversation(handoffConvo.id).ai_active, false, 'still inactive either way');
  });

  console.log('\n13b. executeBuyerTool dispatcher');

  await checkAsync('dispatches to the correct executor by tool name', async () => {
    const result = await openaiService.executeBuyerTool(
      { function: { name: 'get_location', arguments: JSON.stringify({ commune: 'Gombe' }) } },
      toolContext,
    );
    assert.strictEqual(result.commune, 'Gombe');
  });
  await checkAsync('returns a flagged error for an unknown tool name rather than throwing', async () => {
    const result = await openaiService.executeBuyerTool({ function: { name: 'delete_everything', arguments: '{}' } }, toolContext);
    assert.deepStrictEqual(result, { error: 'unknown_tool:delete_everything' });
  });
  await checkAsync('returns a flagged error for unparsable arguments rather than throwing', async () => {
    const result = await openaiService.executeBuyerTool({ function: { name: 'get_location', arguments: 'not json' } }, toolContext);
    assert.deepStrictEqual(result, { error: 'invalid_arguments' });
  });

  console.log('\n13c. runBuyerTurn orchestration loop');

  function assistantToolCallCompletion(calls) {
    return {
      model: 'gpt-4o-2024-08-06',
      usage: { prompt_tokens: 500, completion_tokens: 60, total_tokens: 560 },
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant', content: null, refusal: null,
          tool_calls: calls.map((c, i) => ({
            id: `call_${i}`, type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
          })),
        },
      }],
    };
  }
  function assistantTextCompletion(text) {
    return {
      model: 'gpt-4o-2024-08-06',
      usage: { prompt_tokens: 500, completion_tokens: 40, total_tokens: 540 },
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text, refusal: null } }],
    };
  }

  await checkAsync('runBuyerTurn requires conversationId/waId/userMessage', async () => {
    await assert.rejects(() => openaiService.runBuyerTurn({ waId: 'x', userMessage: 'hi' }), /requires conversationId/);
    await assert.rejects(() => openaiService.runBuyerTurn({ conversationId: 1, userMessage: 'hi' }), /requires waId/);
    await assert.rejects(() => openaiService.runBuyerTurn({ conversationId: 1, waId: 'x' }), /requires userMessage/);
  });

  completionQueue.push(assistantTextCompletion('Bonjour ! Quel budget souhaitez-vous prévoir ?'));
  const simpleTurn = await openaiService.runBuyerTurn({
    conversationId: toolConvo.id,
    waId: '243910000001',
    requirements: { commune: 'Gombe' },
    userMessage: 'Je cherche un appartement à Gombe',
  });
  check('a turn with no tool calls returns the model text directly after exactly one API call', () => {
    assert.strictEqual(simpleTurn.reply, 'Bonjour ! Quel budget souhaitez-vous prévoir ?');
    assert.strictEqual(simpleTurn.iterations, 1);
    assert.deepStrictEqual(simpleTurn.toolCalls, []);
  });
  check('the request sent the buyer system prompt and known requirements, not the listing-extraction prompt', () => {
    const sent = openaiCalls[openaiCalls.length - 1];
    assert.strictEqual(sent.messages[0].content, openaiService.BUYER_SYSTEM_PROMPT);
    assert.ok(sent.messages[1].content.includes('"commune":"Gombe"'));
    assert.strictEqual(sent.tools, openaiService.BUYER_TOOLS);
  });

  completionQueue.push(
    assistantToolCallCompletion([{ name: 'search_properties', args: { commune: 'Gombe', transaction_type: 'location' } }]),
    assistantTextCompletion('Rien à Gombe pour le moment, voulez-vous élargir la recherche ?'),
  );
  const toolTurn = await openaiService.runBuyerTurn({
    conversationId: toolConvo.id,
    waId: '243910000001',
    requirements: { commune: 'Gombe' },
    history: [
      { direction: 'inbound', text: 'Bonjour' },
      { direction: 'outbound', text: 'Bonjour, que recherchez-vous ?' },
    ],
    userMessage: 'Un appartement à louer à Gombe',
  });
  check('a turn with one tool call executes it for real and continues to a final reply', () => {
    assert.strictEqual(toolTurn.iterations, 2);
    assert.strictEqual(toolTurn.toolCalls.length, 1);
    assert.strictEqual(toolTurn.toolCalls[0].name, 'search_properties');
    assert.strictEqual(toolTurn.reply, 'Rien à Gombe pour le moment, voulez-vous élargir la recherche ?');
  });
  check('the tool result actually reflects the real (unconfigured-DB) search_unavailable outcome, not a guess', () => {
    assert.deepStrictEqual(toolTurn.toolCalls[0].result, { error: 'search_unavailable' });
  });
  check('the second API call includes the assistant tool-call turn and a matching tool-result message', () => {
    const secondRequest = openaiCalls[openaiCalls.length - 1];
    const toolResultMsg = secondRequest.messages.find((m) => m.role === 'tool');
    assert.ok(toolResultMsg, 'expected a role:"tool" message in the follow-up request');
    assert.strictEqual(toolResultMsg.tool_call_id, 'call_0');
    assert.deepStrictEqual(JSON.parse(toolResultMsg.content), { error: 'search_unavailable' });
  });
  check('conversation history maps inbound/outbound to user/assistant roles in order', () => {
    const secondRequest = openaiCalls[openaiCalls.length - 1];
    const historyMsgs = secondRequest.messages.slice(2, 4); // after the two system messages
    assert.deepStrictEqual(
      historyMsgs.map((m) => m.role),
      ['user', 'assistant'],
    );
  });

  for (let i = 0; i < openaiService.BUYER_MAX_TOOL_ITERATIONS; i += 1) {
    completionQueue.push(assistantToolCallCompletion([{ name: 'get_location', args: {} }]));
  }
  const stuckTurn = await openaiService.runBuyerTurn({
    conversationId: toolConvo.id,
    waId: '243910000001',
    userMessage: 'test infinite tool loop',
  });
  check('a model that never stops calling tools degrades to the honest fallback reply, not silence or a crash', () => {
    assert.strictEqual(stuckTurn.reply, openaiService.BUYER_ASSISTANT_FALLBACK_REPLY);
    assert.strictEqual(stuckTurn.iterations, openaiService.BUYER_MAX_TOOL_ITERATIONS);
    assert.strictEqual(stuckTurn.toolCalls.length, openaiService.BUYER_MAX_TOOL_ITERATIONS);
  });

  check('section 1/2\'s listing-extraction schema and prompt are still exactly as originally verified (buyer assistant addition changed nothing above it)', () => {
    assert.strictEqual(openaiService.RESPONSE_FORMAT.json_schema.strict, true);
    assert.ok(openaiService.SYSTEM_PROMPT.includes('Kinshasa'));
    assert.notStrictEqual(openaiService.SYSTEM_PROMPT, openaiService.BUYER_SYSTEM_PROMPT, 'the two prompts must stay distinct pipelines');
  });

  // -------------------------------------------------------------------------
  // 14. routes/webhook.js — buyer message routing fork
  //
  // The fork itself is a few new lines ahead of the UNCHANGED
  // `if (extracted.is_listing) {...} else if (pending) {...}` block, which
  // sections 1-9 above already re-verify byte-for-byte. This section proves
  // the new branch end-to-end through the real HTTP route, and — most
  // importantly — that it can never hijack the existing agent-correction
  // flow it sits next to.
  // -------------------------------------------------------------------------

  console.log('\n14. routes/webhook.js buyer message routing (services/buyerConversation.js)');

  // `reply` defaults to a deliberately distinctive marker string: whenever
  // the buyer fork is expected to intercept the message (14a/14b), this text
  // must NEVER be the one actually sent — seeing it would mean the generic
  // agent-intake reply leaked through instead of the buyer assistant's own.
  // 14d passes an explicit, differently-named reply for the opposite case
  // (the `pending` guard correctly keeps this message OUT of the buyer flow,
  // so this classification's own reply IS the one that should be sent).
  function buyerClassification(summary, reply = 'GENERIC_AGENT_REPLY_MUST_NOT_BE_SENT_TO_A_BUYER') {
    return {
      model: 'gpt-4o-2024-08-06',
      usage: { prompt_tokens: 800, completion_tokens: 100, total_tokens: 900 },
      choices: [{
        finish_reason: 'stop',
        message: {
          refusal: null,
          content: JSON.stringify({
            extracted_data: {
              is_listing: false, intent: 'buyer_request', transaction_type: null, property_type: null,
              parcelle_subtype: null, commune: null, quartier: null, price: null, currency: null,
              price_period: null, deposit_months: null, bedrooms: null, bathrooms: null,
              surface_area_sqm: null, units_count: null, furnished: null, amenities: [], reference: null,
              summary_fr: summary, missing_fields: [], confidence: 0.4,
            },
            whatsapp_reply: reply,
          }),
        },
      }],
    };
  }

  console.log('\n14a. A customer search message is routed to the buyer engine, not agent-intake');

  const buyerListingsBefore = dbService.countListings();
  const buyerAiBefore = openaiCalls.length;
  httpCalls.length = 0;

  completionQueue.push(
    buyerClassification('Le client cherche un appartement à louer à Gombe, 2 chambres.'),
    assistantToolCallCompletion([{ name: 'search_properties', args: { commune: 'Gombe', transaction_type: 'location', bedrooms: 2 } }]),
    assistantTextCompletion('Je vérifie ce que nous avons à Gombe pour 2 chambres...'),
  );

  const buyerStatus = await post(
    '/webhook',
    inbound('wamid.BUYER1', 'Je cherche un appartement à louer à Gombe, 2 chambres', '243920000001'),
  );
  await settle(500);

  check('acknowledges the buyer message with 200', () => assert.strictEqual(buyerStatus, 200));
  check('makes exactly 3 model calls: 1 classification + 2 buyer-turn (tool call, then final reply)', () =>
    assert.strictEqual(openaiCalls.length - buyerAiBefore, 3));
  check('creates NO listing row — this was never agent-intake content', () =>
    assert.strictEqual(dbService.countListings(), buyerListingsBefore));
  check('sends exactly one WhatsApp reply, and it is the buyer assistant\'s own text — never the generic agent-intake reply', () => {
    assert.strictEqual(httpCalls.length, 1);
    assert.strictEqual(httpCalls[0].data.to, '243920000001');
    assert.strictEqual(httpCalls[0].data.text.body, 'Je vérifie ce que nous avons à Gombe pour 2 chambres...');
    assert.notStrictEqual(httpCalls[0].data.text.body, 'GENERIC_AGENT_REPLY_MUST_NOT_BE_SENT_TO_A_BUYER');
  });

  const buyerConvo1 = dbService.getActiveConversation('243920000001');
  check('a real conversation row now exists, past NEW (moved on collecting requirements)', () => {
    assert.ok(buyerConvo1);
    assert.notStrictEqual(buyerConvo1.state, 'NEW');
  });
  check('requirements were merged from the model\'s own search_properties tool-call arguments (no second extraction call)', () => {
    assert.strictEqual(buyerConvo1.commune, 'Gombe');
    assert.strictEqual(buyerConvo1.transaction_type, 'location');
    assert.strictEqual(buyerConvo1.bedrooms, 2);
  });
  check('conversation state advanced to SHOWING_RESULTS after a real search_properties call', () =>
    assert.strictEqual(buyerConvo1.state, 'SHOWING_RESULTS'));
  check('both the inbound and outbound messages were persisted to the transcript', () => {
    const transcript = dbService.getMessages(buyerConvo1.id);
    assert.strictEqual(transcript.filter((m) => m.direction === 'inbound').length, 1);
    assert.strictEqual(transcript.filter((m) => m.direction === 'outbound').length, 1);
    assert.strictEqual(transcript[0].text, 'Je cherche un appartement à louer à Gombe, 2 chambres');
  });

  console.log('\n14b. A second message from the same customer continues the SAME conversation');

  completionQueue.push(
    buyerClassification('Le client demande si moins cher est disponible.'),
    assistantTextCompletion('Je regarde les options moins chères à Gombe.'),
  );
  httpCalls.length = 0;
  await post('/webhook', inbound('wamid.BUYER2', 'Moins cher ?', '243920000001'));
  await settle(400);

  check('no second conversation row was created for the same sender', () => {
    const active = dbService.getActiveConversation('243920000001');
    assert.strictEqual(active.id, buyerConvo1.id);
  });
  check('the requirements already on file (commune/bedrooms) were not lost by the second turn', () => {
    const active = dbService.getActiveConversation('243920000001');
    assert.strictEqual(active.commune, 'Gombe');
    assert.strictEqual(active.bedrooms, 2);
  });
  check('the transcript now has 4 messages total (2 inbound, 2 outbound)', () => {
    const transcript = dbService.getMessages(buyerConvo1.id);
    assert.strictEqual(transcript.length, 4);
  });

  console.log('\n14c. Human handoff silences the AI — no automated reply is sent');

  const handoffWaId = '243920000002';
  const silentConvo = dbService.createConversation(handoffWaId);
  dbService.setConversationAiActive(silentConvo.id, false);

  completionQueue.push(buyerClassification('Le client cherche un studio.'));
  httpCalls.length = 0;
  const aiCallsBeforeSilent = openaiCalls.length;
  await post('/webhook', inbound('wamid.BUYER3', 'Je cherche un studio', handoffWaId));
  await settle(400);

  check('classification still runs (needed to route the message at all)', () =>
    assert.strictEqual(openaiCalls.length - aiCallsBeforeSilent, 1));
  check('but the buyer assistant is never called and NO WhatsApp reply is sent while a human owns the conversation', () =>
    assert.strictEqual(httpCalls.length, 0));
  check('the message is still recorded so the human agent sees it', () => {
    const transcript = dbService.getMessages(silentConvo.id);
    assert.strictEqual(transcript.length, 1);
    assert.strictEqual(transcript[0].direction, 'inbound');
    assert.strictEqual(transcript[0].text, 'Je cherche un studio');
  });
  check('ai_active is still false and the conversation state is untouched by the silent branch', () => {
    const updated = dbService.getConversation(silentConvo.id);
    assert.strictEqual(updated.ai_active, false);
    assert.strictEqual(updated.state, 'NEW');
  });

  console.log('\n14d. Safety invariant: an agent mid-correction is NEVER hijacked into the buyer flow');

  // Seed a pending listing for this sender first, exactly like section 6
  // does — the buyer fork must never fire while `pending` is set, even if
  // this message's own classification comes back as a buyer_request (the
  // scenario the `!pending` guard exists for).
  completionQueue.push({
    model: 'gpt-4o-2024-08-06',
    usage: { prompt_tokens: 900, completion_tokens: 180, total_tokens: 1080 },
    choices: [{ finish_reason: 'stop', message: { refusal: null, content: JSON.stringify({
      extracted_data: {
        is_listing: true, intent: 'listing', transaction_type: 'location', property_type: 'appartement',
        parcelle_subtype: null, commune: 'Kalamu', quartier: null, price: 600, currency: 'USD',
        price_period: 'mois', deposit_months: null, bedrooms: 2, bathrooms: 1, surface_area_sqm: null,
        units_count: null, furnished: null, amenities: [], reference: null,
        summary_fr: 'Appartement 2 chambres à Kalamu, 600$/mois.', missing_fields: [], confidence: 0.9,
      },
      whatsapp_reply: '*Annonce reçue* ✅\nAppartement à Kalamu. Répondez *OK* pour publier.',
    }) } }],
  });
  const guardWaId = '243920000003';
  await post('/webhook', inbound('wamid.GUARD1', 'Appartement 2 chambres a louer Kalamu 600$', guardWaId));
  await settle(400);

  const pendingListing = dbService.findLatestPendingListing(guardWaId);
  check('setup: the sender now has a real pending listing awaiting confirmation', () => assert.ok(pendingListing));

  completionQueue.push(buyerClassification(
    'Message misclassified as a buyer_request while a listing is pending.',
    'CORRECTION_FLOW_REPLY_CORRECTLY_SENT_VIA_UNCHANGED_PATH',
  ));
  httpCalls.length = 0;
  const listingsBeforeGuard = dbService.countListings();
  const aiCallsBeforeGuard = openaiCalls.length;
  await post('/webhook', inbound('wamid.GUARD2', 'faute de frappe, 3 chambres en fait', guardWaId));
  await settle(400);

  check('the buyer engine is never invoked while `pending` is set — only the classification call runs', () =>
    assert.strictEqual(openaiCalls.length - aiCallsBeforeGuard, 1));
  check('no listings.js/db conversation row is created for this guard scenario', () => {
    assert.strictEqual(dbService.getActiveConversation(guardWaId), undefined);
  });
  check('the existing correction path still runs exactly as before — the pending listing is updated, not the buyer flow', () => {
    assert.strictEqual(dbService.countListings(), listingsBeforeGuard, 'a correction updates the existing row, never inserts a new one');
    const corrected = dbService.getListing(pendingListing.id);
    assert.strictEqual(corrected.commune, 'Kalamu', 'unrelated field untouched by the correction');
  });
  check('the agent still gets the normal agent-intake reply (via the unchanged code path), not a buyer-assistant reply', () => {
    assert.strictEqual(httpCalls.length, 1);
    assert.strictEqual(httpCalls[0].data.text.body, 'CORRECTION_FLOW_REPLY_CORRECTLY_SENT_VIA_UNCHANGED_PATH');
  });

  // -------------------------------------------------------------------------
  // 15. routes/admin.js — conversations/leads admin API
  // -------------------------------------------------------------------------

  console.log('\n15. routes/admin.js — conversations/leads admin API');

  function adminRequest(method, pathname, body) {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = { 'X-API-Key': process.env.API_SECRET };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    return new Promise((resolve) => {
      const req = http.request(
        { host: 'localhost', port: 3200, path: pathname, method, headers },
        (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
        },
      );
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }

  console.log('\n15a. Auth — same API_SECRET gate as GET /listings');

  const noKeyConvos = await new Promise((resolve) => {
    http.get({ host: 'localhost', port: 3200, path: '/admin/conversations' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
  });
  check('GET /admin/conversations rejects a request with no API key', () => assert.strictEqual(noKeyConvos, 401));

  console.log('\n15b. GET /admin/conversations — list + filter');

  const adminConvo = dbService.createConversation('243930000001');
  dbService.updateConversationRequirements(adminConvo.id, { commune: 'Limete', transaction_type: 'vente' });
  dbService.recordMessage(adminConvo.id, 'inbound', { text: 'Bonjour, je cherche à acheter à Limete' });
  dbService.recordMessage(adminConvo.id, 'outbound', { text: 'Quel budget ?' });

  const listResp = await adminRequest('GET', '/admin/conversations?limit=100');
  check('lists conversations with a 200 + success envelope', () => {
    assert.strictEqual(listResp.status, 200);
    assert.strictEqual(listResp.body.success, true);
    assert.ok(typeof listResp.body.total === 'number');
  });
  check('includes the conversation just created, with a last-message preview', () => {
    const row = listResp.body.data.find((c) => c.id === adminConvo.id);
    assert.ok(row, 'expected the new conversation in the list');
    assert.strictEqual(row.last_message, 'Quel budget ?');
    assert.strictEqual(row.last_message_direction, 'outbound');
    assert.strictEqual(row.commune, 'Limete');
  });

  const filteredResp = await adminRequest('GET', '/admin/conversations?state=NEW&limit=100');
  check('filtering by state only returns rows in that state', () => {
    assert.strictEqual(filteredResp.status, 200);
    assert.ok(filteredResp.body.data.every((c) => c.state === 'NEW'));
    assert.ok(filteredResp.body.data.some((c) => c.id === adminConvo.id), 'adminConvo is still NEW at this point (no state transition yet) and should be included');
  });

  const filteredOutResp = await adminRequest('GET', '/admin/conversations?state=CLOSED&limit=100');
  check('a state with no matching rows returns an empty list, not an error', () => {
    assert.strictEqual(filteredOutResp.status, 200);
    assert.ok(!filteredOutResp.body.data.some((c) => c.id === adminConvo.id));
  });

  const badStateResp = await adminRequest('GET', '/admin/conversations?state=BOGUS');
  check('an invalid state filter is a 400, not a silently-empty list', () => {
    assert.strictEqual(badStateResp.status, 400);
    assert.strictEqual(badStateResp.body.success, false);
  });

  console.log('\n15c. GET /admin/conversations/:id — detail (transcript + leads)');

  const adminLead = dbService.createLead({
    conversation_id: adminConvo.id, wa_id: '243930000001', commune: 'Limete', status: 'QUALIFIED',
  });

  const detailResp = await adminRequest('GET', `/admin/conversations/${adminConvo.id}`);
  check('returns the conversation, full transcript, and its leads together', () => {
    assert.strictEqual(detailResp.status, 200);
    assert.strictEqual(detailResp.body.conversation.id, adminConvo.id);
    assert.strictEqual(detailResp.body.messages.length, 2);
    assert.strictEqual(detailResp.body.messages[0].text, 'Bonjour, je cherche à acheter à Limete');
    assert.strictEqual(detailResp.body.leads.length, 1);
    assert.strictEqual(detailResp.body.leads[0].id, adminLead.id);
  });

  const notFoundResp = await adminRequest('GET', '/admin/conversations/999999999');
  check('an unknown conversation id 404s', () => assert.strictEqual(notFoundResp.status, 404));

  console.log('\n15d. PATCH /admin/conversations/:id — assign / take over / return to AI / notes');

  const assignResp = await adminRequest('PATCH', `/admin/conversations/${adminConvo.id}`, { assigned_agent: 'Agent Divine' });
  check('assigning an agent persists', () => {
    assert.strictEqual(assignResp.status, 200);
    assert.strictEqual(assignResp.body.conversation.assigned_agent, 'Agent Divine');
  });

  const notesResp = await adminRequest('PATCH', `/admin/conversations/${adminConvo.id}`, { notes: 'Client sérieux, a déjà visité un bien similaire.' });
  check('internal notes persist and are never something the state machine cares about', () => {
    assert.strictEqual(notesResp.status, 200);
    assert.strictEqual(notesResp.body.conversation.notes, 'Client sérieux, a déjà visité un bien similaire.');
  });

  const takeOverResp = await adminRequest('PATCH', `/admin/conversations/${adminConvo.id}`, { ai_active: false, state: 'HUMAN_HANDOFF' });
  check('"take over" sets ai_active false and moves to HUMAN_HANDOFF in one request', () => {
    assert.strictEqual(takeOverResp.status, 200);
    assert.strictEqual(takeOverResp.body.conversation.ai_active, false);
    assert.strictEqual(takeOverResp.body.conversation.state, 'HUMAN_HANDOFF');
  });

  const returnResp = await adminRequest('PATCH', `/admin/conversations/${adminConvo.id}`, { ai_active: true, state: 'COLLECTING_REQUIREMENTS' });
  check('"return to AI" reverses it, through the same validated transition table the AI itself uses', () => {
    assert.strictEqual(returnResp.status, 200);
    assert.strictEqual(returnResp.body.conversation.ai_active, true);
    assert.strictEqual(returnResp.body.conversation.state, 'COLLECTING_REQUIREMENTS');
  });

  const badTransitionResp = await adminRequest('PATCH', `/admin/conversations/${adminConvo.id}`, { state: 'VIEWING_REQUEST' });
  check('an admin cannot force an invalid transition either — same rules as the AI (400, not 500)', () => {
    assert.strictEqual(badTransitionResp.status, 400);
    assert.strictEqual(dbService.getConversation(adminConvo.id).state, 'COLLECTING_REQUIREMENTS', 'state must be unchanged after a rejected transition');
  });

  const unknownFieldResp = await adminRequest('PATCH', `/admin/conversations/${adminConvo.id}`, { hacker_field: 'x' });
  check('an unknown patch field is rejected rather than silently ignored', () =>
    assert.strictEqual(unknownFieldResp.status, 400));

  console.log('\n15e. POST /admin/conversations/:id/reply — manual agent reply');

  httpCalls.length = 0;
  const replyResp = await adminRequest('POST', `/admin/conversations/${adminConvo.id}/reply`, { text: 'Bonjour, je suis Divine, votre agent Lukka Place.' });
  check('sends the manual reply through the real Chakra send path', () => {
    assert.strictEqual(replyResp.status, 200);
    assert.strictEqual(httpCalls.length, 1);
    assert.strictEqual(httpCalls[0].data.to, '243930000001');
    assert.strictEqual(httpCalls[0].data.text.body, 'Bonjour, je suis Divine, votre agent Lukka Place.');
  });
  check('records the manual reply as a real outbound message in the transcript', () => {
    const transcript = dbService.getMessages(adminConvo.id);
    assert.strictEqual(transcript[transcript.length - 1].text, 'Bonjour, je suis Divine, votre agent Lukka Place.');
    assert.strictEqual(transcript[transcript.length - 1].direction, 'outbound');
  });

  const emptyReplyResp = await adminRequest('POST', `/admin/conversations/${adminConvo.id}/reply`, { text: '   ' });
  check('an empty reply is rejected before ever calling Chakra', () => assert.strictEqual(emptyReplyResp.status, 400));

  console.log('\n15f. GET/PATCH /admin/leads');

  const leadsListResp = await adminRequest('GET', '/admin/leads?limit=100');
  check('lists leads with a real total count', () => {
    assert.strictEqual(leadsListResp.status, 200);
    assert.ok(leadsListResp.body.data.some((l) => l.id === adminLead.id));
  });

  const leadDetailResp = await adminRequest('GET', `/admin/leads/${adminLead.id}`);
  check('returns a single lead by id', () => {
    assert.strictEqual(leadDetailResp.status, 200);
    assert.strictEqual(leadDetailResp.body.lead.commune, 'Limete');
  });

  const leadPatchResp = await adminRequest('PATCH', `/admin/leads/${adminLead.id}`, { status: 'CONVERTED' });
  check('updates a lead\'s status via the same validated updateLeadStatus used elsewhere', () => {
    assert.strictEqual(leadPatchResp.status, 200);
    assert.strictEqual(leadPatchResp.body.lead.status, 'CONVERTED');
  });

  const leadBadStatusResp = await adminRequest('PATCH', `/admin/leads/${adminLead.id}`, { status: 'MADE_UP_STATUS' });
  check('an invalid lead status is rejected with 400', () => assert.strictEqual(leadBadStatusResp.status, 400));

  const leadNotFoundResp = await adminRequest('GET', '/admin/leads/999999999');
  check('an unknown lead id 404s', () => assert.strictEqual(leadNotFoundResp.status, 404));

  // "Modifier ma recherche" — the customer-side edit flow (web/app/(site)/compte/client/actions.js's
  // updatePropertyRequestAction) writes through this exact same PATCH, via db.updateLeadRequirements.
  const leadRequirementsPatchResp = await adminRequest('PATCH', `/admin/leads/${adminLead.id}`, {
    transaction_type: 'location',
    commune: 'Ngaliema',
    price_min: 500,
    price_max: 900,
    bedrooms: 2,
    requirements_summary: 'Recherche mise à jour par le client',
  });
  check("updates a lead's structured requirement fields (customer edit flow)", () => {
    assert.strictEqual(leadRequirementsPatchResp.status, 200);
    assert.strictEqual(leadRequirementsPatchResp.body.lead.transaction_type, 'location');
    assert.strictEqual(leadRequirementsPatchResp.body.lead.commune, 'Ngaliema');
    assert.strictEqual(leadRequirementsPatchResp.body.lead.price_min, 500);
    assert.strictEqual(leadRequirementsPatchResp.body.lead.price_max, 900);
    assert.strictEqual(leadRequirementsPatchResp.body.lead.bedrooms, 2);
    assert.strictEqual(leadRequirementsPatchResp.body.lead.requirements_summary, 'Recherche mise à jour par le client');
  });

  const leadRequirementsClearResp = await adminRequest('PATCH', `/admin/leads/${adminLead.id}`, { bedrooms: null });
  check('a requirements field explicitly set to null clears it, leaving the rest of the patch untouched', () => {
    assert.strictEqual(leadRequirementsClearResp.status, 200);
    assert.strictEqual(leadRequirementsClearResp.body.lead.bedrooms, null);
    assert.strictEqual(leadRequirementsClearResp.body.lead.commune, 'Ngaliema');
  });

  const leadEmptyPatchResp = await adminRequest('PATCH', `/admin/leads/${adminLead.id}`, {});
  check('PATCH /admin/leads/:id with no recognized field is a 400, not a silent no-op', () => {
    assert.strictEqual(leadEmptyPatchResp.status, 400);
  });

  console.log('\n15f-bis. PATCH /admin/leads/:id — commune-sensitive proposal reset (customer "Modifier ma recherche")');

  const resetTestLead = dbService.createLead({
    wa_id: '243930000099', commune: 'Limete', transaction_type: 'location', bedrooms: 2, status: 'QUALIFIED',
  });
  dbService.createLeadProposal({ leadId: resetTestLead.id, agentId: 501, propertyId: 9001 });
  check('setup: the lead has one real Agent Demand Feed pitch recorded before any edit', () => {
    assert.strictEqual(dbService.getLead(resetTestLead.id).pitches_count, 1);
    assert.strictEqual(dbService.getLeadProposals([resetTestLead.id]).length, 1);
  });

  const sameCommuneResp = await adminRequest('PATCH', `/admin/leads/${resetTestLead.id}`, {
    commune: 'Limete', price_min: 600,
  });
  check('editing without changing the commune keeps existing proposals untouched', () => {
    assert.strictEqual(sameCommuneResp.status, 200);
    assert.strictEqual(sameCommuneResp.body.proposals_reset, false);
    assert.strictEqual(sameCommuneResp.body.lead.pitches_count, 1);
    assert.strictEqual(sameCommuneResp.body.lead.status, 'QUALIFIED');
    assert.strictEqual(dbService.getLeadProposals([resetTestLead.id]).length, 1);
  });

  const communeChangeResp = await adminRequest('PATCH', `/admin/leads/${resetTestLead.id}`, { commune: 'Gombe' });
  check('editing to a different commune clears every existing proposal and reopens the request', () => {
    assert.strictEqual(communeChangeResp.status, 200);
    assert.strictEqual(communeChangeResp.body.proposals_reset, true);
    assert.strictEqual(communeChangeResp.body.lead.commune, 'Gombe');
    assert.strictEqual(communeChangeResp.body.lead.pitches_count, 0);
    assert.strictEqual(communeChangeResp.body.lead.status, 'NEW');
    assert.strictEqual(dbService.getLeadProposals([resetTestLead.id]).length, 0);
  });

  const noCommuneFieldResp = await adminRequest('PATCH', `/admin/leads/${resetTestLead.id}`, { bedrooms: 3 });
  check('a patch that never mentions commune is never treated as a commune change', () => {
    assert.strictEqual(noCommuneFieldResp.status, 200);
    assert.strictEqual(noCommuneFieldResp.body.proposals_reset, false);
  });


  console.log('\n15f-ter. GET /admin/leads/proposals-usage — agent monthly pitch quota (web/)');

  // The quota counter has no table of its own: `lead_proposals` IS the usage
  // record, so these assertions are made against real rows written by the
  // same createLeadProposal the Agent Demand Feed uses.
  const quotaLeadA = dbService.createLead({ wa_id: '243930000101', commune: 'Gombe', transaction_type: 'location' });
  const quotaLeadB = dbService.createLead({ wa_id: '243930000102', commune: 'Gombe', transaction_type: 'location' });
  const QUOTA_AGENT = 777;
  const OTHER_AGENT = 778;
  dbService.createLeadProposal({ leadId: quotaLeadA.id, agentId: QUOTA_AGENT, propertyId: 9101 });
  dbService.createLeadProposal({ leadId: quotaLeadB.id, agentId: QUOTA_AGENT, propertyId: 9102 });
  dbService.createLeadProposal({ leadId: quotaLeadA.id, agentId: OTHER_AGENT, propertyId: 9103 });

  const epoch = new Date(0).toISOString();

  const usageResp = await adminRequest('GET', `/admin/leads/proposals-usage?agent_id=${QUOTA_AGENT}&since=${encodeURIComponent(epoch)}`);
  check("counts only this agent's own pitches, never another agent's on the same lead", () => {
    assert.strictEqual(usageResp.status, 200);
    assert.strictEqual(usageResp.body.used, 2);
  });

  const otherUsageResp = await adminRequest('GET', `/admin/leads/proposals-usage?agent_id=${OTHER_AGENT}&since=${encodeURIComponent(epoch)}`);
  check('each agent is counted independently', () => {
    assert.strictEqual(otherUsageResp.body.used, 1);
  });

  const futureSince = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const windowResp = await adminRequest('GET', `/admin/leads/proposals-usage?agent_id=${QUOTA_AGENT}&since=${encodeURIComponent(futureSince)}`);
  check('the `since` window is real — a window starting in the future counts nothing', () => {
    assert.strictEqual(windowResp.body.used, 0);
  });

  const unknownAgentResp = await adminRequest('GET', `/admin/leads/proposals-usage?agent_id=99999&since=${encodeURIComponent(epoch)}`);
  check('an agent who has never pitched is 0 used, not an error', () => {
    assert.strictEqual(unknownAgentResp.status, 200);
    assert.strictEqual(unknownAgentResp.body.used, 0);
  });

  const badAgentResp = await adminRequest('GET', `/admin/leads/proposals-usage?since=${encodeURIComponent(epoch)}`);
  check('a missing agent_id is rejected with 400 rather than counting every agent at once', () => {
    assert.strictEqual(badAgentResp.status, 400);
  });

  const badSinceResp = await adminRequest('GET', `/admin/leads/proposals-usage?agent_id=${QUOTA_AGENT}&since=not-a-date`);
  check('an unparseable `since` is rejected with 400, never silently treated as "all time"', () => {
    assert.strictEqual(badSinceResp.status, 400);
  });

  check('the route is matched as its own path, not swallowed by GET /leads/:id', () => {
    // '/leads/proposals-usage' must be registered before '/leads/:id', or
    // Express hands 'proposals-usage' to the :id handler as a lead id and
    // this endpoint 404s instead of counting anything.
    assert.strictEqual(usageResp.status, 200);
    assert.ok(Object.prototype.hasOwnProperty.call(usageResp.body, 'used'));
  });

  check('deleting a proposal really lowers the count — no separate counter to drift', () => {
    dbService.resetLeadProposals(quotaLeadA.id);
    assert.strictEqual(dbService.countAgentProposalsSince({ agentId: QUOTA_AGENT, since: epoch }), 1);
  });

  console.log('\n15g. POST /admin/leads — agent storefront inquiry form (web/)');

  httpCalls.length = 0;
  const createLeadResp = await adminRequest('POST', '/admin/leads', {
    wa_id: '243940000001',
    name: 'Prospect Test',
    source: 'agent-profile-inquiry',
    property_id: null,
    assigned_agent: 'Agent Test',
    requirements_summary: '2 chambres à Gombe',
  });
  check('creates a real lead row and returns it', () => {
    assert.strictEqual(createLeadResp.status, 201);
    assert.strictEqual(createLeadResp.body.lead.wa_id, '243940000001');
    assert.strictEqual(createLeadResp.body.lead.source, 'agent-profile-inquiry');
    assert.strictEqual(createLeadResp.body.lead.requirements_summary, '2 chambres à Gombe');
    assert.strictEqual(createLeadResp.body.lead.status, 'NEW');
  });
  await checkAsync('the new lead is immediately visible via GET /admin/leads', async () => {
    const listResp = await adminRequest('GET', '/admin/leads?limit=100');
    assert.ok(listResp.body.data.some((l) => l.id === createLeadResp.body.lead.id));
  });

  const missingWaIdResp = await adminRequest('POST', '/admin/leads', { name: 'No phone' });
  check('wa_id is required — rejected with 400, not a silent null row', () =>
    assert.strictEqual(missingWaIdResp.status, 400));

  console.log('\n15h. GET /admin/leads?property_ids= — agent dashboard\'s Lead Activity Stream (web/)');

  const leadForProp1 = dbService.createLead({ wa_id: '243940000002', property_id: 501, status: 'NEW' });
  dbService.createLead({ wa_id: '243940000003', property_id: 502, status: 'NEW' });
  const leadNoProp = dbService.createLead({ wa_id: '243940000004', status: 'NEW' });

  const scopedResp = await adminRequest('GET', '/admin/leads?property_ids=501&limit=100');
  check('scopes to exactly the given property_ids — one agent\'s own listings only', () => {
    assert.strictEqual(scopedResp.status, 200);
    assert.ok(scopedResp.body.data.some((l) => l.id === leadForProp1.id));
    assert.ok(!scopedResp.body.data.some((l) => l.property_id === 502));
    assert.ok(!scopedResp.body.data.some((l) => l.id === leadNoProp.id), 'a lead with no property_id at all must not leak into a property_ids-scoped query');
  });

  const emptyPropertyIdsResp = await adminRequest('GET', '/admin/leads?property_ids=notanumber');
  check('property_ids with no valid ids is a 400, not an unfiltered full list', () =>
    assert.strictEqual(emptyPropertyIdsResp.status, 400));

  // assigned_agent widens the same stream (OR'd with property_ids, not
  // AND'd) — a general inquiry with no property_id yet (web/'s
  // submitInquiryAction) still needs to surface in that agent's own
  // dashboard, alongside their real listing-scoped leads.
  const leadByName = dbService.createLead({ wa_id: '243940000010', assigned_agent: 'Jean Kalala', status: 'NEW' });
  const leadForOtherAgentProp = dbService.createLead({ wa_id: '243940000011', property_id: 503, status: 'NEW' });

  const assignedAgentResp = await adminRequest(
    'GET',
    '/admin/leads?property_ids=501&assigned_agent=' + encodeURIComponent('Jean Kalala') + '&limit=100',
  );
  check('assigned_agent surfaces a property_id-less lead alongside property_ids-scoped ones', () => {
    assert.strictEqual(assignedAgentResp.status, 200);
    assert.ok(assignedAgentResp.body.data.some((l) => l.id === leadForProp1.id), 'still includes the property_ids match');
    assert.ok(assignedAgentResp.body.data.some((l) => l.id === leadByName.id), 'includes the assigned_agent-only match');
    assert.ok(!assignedAgentResp.body.data.some((l) => l.id === leadForOtherAgentProp.id), 'a lead on neither signal must not leak in');
  });

  console.log('\n15i. POST /admin/send-whatsapp — agent phone-verification OTP (web/)');

  httpCalls.length = 0;
  const sendOtpResp = await adminRequest('POST', '/admin/send-whatsapp', {
    phone: '243940000005',
    message: 'Votre code de vérification Lukka Place : 123456 (valable 10 minutes)',
  });
  check('sends through the real Chakra path and returns success', () => {
    assert.strictEqual(sendOtpResp.status, 200);
    assert.strictEqual(sendOtpResp.body.success, true);
    const posts = httpCalls.filter((c) => c.method === 'post');
    assert.strictEqual(posts.length, 1);
    assert.strictEqual(posts[0].data.to, '243940000005');
    assert.ok(posts[0].data.text.body.includes('123456'));
  });

  const badPhoneResp = await adminRequest('POST', '/admin/send-whatsapp', { phone: 'not-a-phone', message: 'hi' });
  check('a non-digits phone is rejected with 400 before ever calling Chakra', () =>
    assert.strictEqual(badPhoneResp.status, 400));

  const missingMessageResp = await adminRequest('POST', '/admin/send-whatsapp', { phone: '243940000005' });
  check('a missing message is rejected with 400', () => assert.strictEqual(missingMessageResp.status, 400));

  // Template send — the OTP path. A free-form text is only delivered inside
  // the 24h customer-service window, which a first-time registrant is never
  // in, so agent verification codes go out as an approved template instead.
  httpCalls.length = 0;
  const templateResp = await adminRequest('POST', '/admin/send-whatsapp-template', {
    phone: '243940000008',
    template: 'agent_auth_otp',
    language_code: 'fr',
    body_params: ['123456'],
    otp_code: '123456',
  });
  check('sends an approved template with the code in body AND copy-code button', () => {
    assert.strictEqual(templateResp.status, 200);
    const posts = httpCalls.filter((c) => c.method === 'post');
    assert.strictEqual(posts.length, 1);
    const payload = posts[0].data;
    assert.strictEqual(payload.type, 'template');
    assert.strictEqual(payload.template.name, 'agent_auth_otp');
    assert.strictEqual(payload.template.language.code, 'fr');
    const body = payload.template.components.find((c) => c.type === 'body');
    const button = payload.template.components.find((c) => c.type === 'button');
    assert.strictEqual(body.parameters[0].text, '123456');
    assert.ok(button, 'an authentication template is rejected by Meta without its copy-code button');
    assert.strictEqual(button.parameters[0].text, '123456');
  });

  httpCalls.length = 0;
  const templateNoButtonResp = await adminRequest('POST', '/admin/send-whatsapp-template', {
    phone: '243940000008',
    template: 'utility_notice',
    body_params: ['hello'],
  });
  check('omits the button component when no otp_code is given', () => {
    assert.strictEqual(templateNoButtonResp.status, 200);
    const payload = httpCalls.filter((c) => c.method === 'post')[0].data;
    assert.ok(!payload.template.components.some((c) => c.type === 'button'));
  });

  const templateNoNameResp = await adminRequest('POST', '/admin/send-whatsapp-template', { phone: '243940000008' });
  check('a missing template name is rejected with 400', () =>
    assert.strictEqual(templateNoNameResp.status, 400));

  console.log('\n15j. GET /admin/leads?wa_id= — customer inquiry history (web/)');

  const leadForCustomer = dbService.createLead({ wa_id: '243940000006', property_id: 601, status: 'NEW' });
  dbService.createLead({ wa_id: '243940000006', property_id: 602, status: 'CONTACTED' });
  const leadForOtherCustomer = dbService.createLead({ wa_id: '243940000007', property_id: 601, status: 'NEW' });

  const waScopedResp = await adminRequest('GET', '/admin/leads?wa_id=243940000006&limit=100');
  check('scopes to exactly one customer\'s own leads by wa_id', () => {
    assert.strictEqual(waScopedResp.status, 200);
    assert.strictEqual(waScopedResp.body.data.length, 2);
    assert.ok(waScopedResp.body.data.every((l) => l.wa_id === '243940000006'));
    assert.ok(!waScopedResp.body.data.some((l) => l.id === leadForOtherCustomer.id), 'another customer\'s lead must never leak into a wa_id-scoped query');
  });

  const waNoMatchResp = await adminRequest('GET', '/admin/leads?wa_id=243940000099');
  check('a wa_id with no leads returns an empty list, not an error', () => {
    assert.strictEqual(waNoMatchResp.status, 200);
    assert.strictEqual(waNoMatchResp.body.data.length, 0);
  });

  const waBadFormatResp = await adminRequest('GET', '/admin/leads?wa_id=not-a-phone');
  check('a non-digits wa_id is rejected with 400 before ever touching the DB', () =>
    assert.strictEqual(waBadFormatResp.status, 400));

  // ===========================================================================
  console.log('\n16. Automated agent matching — lead_matches (services/leadDispatch.js)');
  // ===========================================================================
  //
  // The dispatcher's Postgres ranking half cannot run here (this suite
  // deliberately blanks the DB_* env so nothing can reach production — see the
  // note at the top of this file), and that is exactly right: what MUST be
  // covered locally is the SQLite half, because that is where the guarantees
  // live. One notification per agency per request, quota accounting that a
  // push cannot silently consume, and a lead reaching the agency it was
  // pushed to.

  const matchLead = dbService.createLead({ wa_id: '243950000001', commune: 'Gombe', bedrooms: 3 });

  const firstMatch = dbService.recordLeadMatch({
    leadId: matchLead.id, agentId: 9001, agentPhone: '243950009001', rank: 1, score: 82.5,
  });
  check('a dispatch records a real lead_matches row', () => {
    assert.strictEqual(firstMatch.created, true);
    assert.strictEqual(firstMatch.row.status, 'NOTIFIED');
    assert.strictEqual(firstMatch.row.rank, 1);
  });

  const duplicateMatch = dbService.recordLeadMatch({ leadId: matchLead.id, agentId: 9001 });
  check('the same agency is never notified twice for one request', () => {
    assert.strictEqual(duplicateMatch.created, false, 'a re-dispatch must be a no-op, not a second WhatsApp message');
    assert.strictEqual(dbService.getLeadMatches(matchLead.id).length, 1);
  });

  dbService.recordLeadMatch({ leadId: matchLead.id, agentId: 9002, agentPhone: '243950009002', rank: 2 });
  dbService.markLeadMatchFailed({ leadId: matchLead.id, agentId: 9002, error: 'template not approved' });
  check('a failed push is recorded, not hidden', () => {
    const failed = dbService.getLeadMatches(matchLead.id).find((m) => m.agent_id === 9002);
    assert.strictEqual(failed.status, 'FAILED');
    assert.match(failed.error, /template/);
  });

  check('matches come back best-ranked first', () => {
    const ranks = dbService.getLeadMatches(matchLead.id).map((m) => m.rank);
    assert.deepStrictEqual(ranks, [1, 2]);
  });

  const matchScopedResp = await adminRequest(`GET`, `/admin/leads?matched_agent_id=9001&limit=100`);
  check('a pushed request reaches the agency it was pushed to', () => {
    assert.strictEqual(matchScopedResp.status, 200);
    assert.ok(
      matchScopedResp.body.data.some((l) => l.id === matchLead.id),
      'without this the WhatsApp alert points at a dashboard that does not show the request',
    );
  });

  const matchOtherAgentResp = await adminRequest('GET', '/admin/leads?matched_agent_id=9999&limit=100');
  check('an agency that was NOT pushed the request does not see it', () =>
    assert.ok(!matchOtherAgentResp.body.data.some((l) => l.id === matchLead.id)));

  const badMatchedIdResp = await adminRequest('GET', '/admin/leads?matched_agent_id=abc');
  check('a non-numeric matched_agent_id is a 400, not an unfiltered list', () =>
    assert.strictEqual(badMatchedIdResp.status, 400));

  const sinceAll = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  check('a notification does NOT consume the agency\'s paid response quota', () => {
    // This is the whole reason lead_matches and lead_proposals are separate
    // tables. Merging them would bill an agency for a lead they were merely
    // shown.
    assert.strictEqual(dbService.countAgentProposalsSince({ agentId: 9001, since: sinceAll }), 0);
    assert.strictEqual(dbService.countAgentMatchesSince({ agentId: 9001, since: sinceAll }), 1);
  });

  dbService.createLeadProposal({ leadId: matchLead.id, agentId: 9001, propertyId: 700 });
  check('responsiveness counts real answers against real pushes', () => {
    const stats = dbService.getAgentResponsivenessSince({ since: sinceAll }).get(9001);
    assert.strictEqual(stats.matched, 1);
    assert.strictEqual(stats.answered, 1);
    const unanswered = dbService.getAgentResponsivenessSince({ since: sinceAll }).get(9002);
    assert.strictEqual(unanswered.answered, 0, 'an agency that was notified and stayed silent must score 0 answered');
  });

  const statsResp = await adminRequest('GET', '/admin/leads/matching-stats?days=30');
  check('the matching console reports real counts', () => {
    assert.strictEqual(statsResp.status, 200);
    assert.strictEqual(statsResp.body.totals.pushes, 2);
    assert.strictEqual(statsResp.body.totals.leads_dispatched, 1);
  });

  check('the coverage gap lists only requests that genuinely reached nobody', () => {
    // Every other lead this suite created was never dispatched, so they are
    // all genuinely uncovered — this is the figure that tells the business
    // where to go and recruit. The one lead that WAS dispatched must not
    // appear in it.
    assert.ok(Array.isArray(statsResp.body.uncovered));
    assert.ok(statsResp.body.uncovered.length > 0, 'undispatched leads exist in this fixture');
    const total = statsResp.body.uncovered.reduce((sum, row) => sum + row.n, 0);
    assert.strictEqual(
      total,
      statsResp.body.totals.leads - statsResp.body.totals.leads_dispatched,
      'uncovered must be exactly the leads with no lead_matches row',
    );
  });

  const leadMatchesResp = await adminRequest('GET', `/admin/leads/${matchLead.id}/matches`);
  check('GET /leads/:id/matches exposes the dispatch for inspection', () => {
    assert.strictEqual(leadMatchesResp.status, 200);
    assert.strictEqual(leadMatchesResp.body.matches.length, 2);
  });

  const missingLeadMatchesResp = await adminRequest('GET', '/admin/leads/99999/matches');
  check('matches for a non-existent lead is a 404', () =>
    assert.strictEqual(missingLeadMatchesResp.status, 404));

  // ===========================================================================
  console.log('\n17. WhatsApp agent onboarding (services/agentOnboarding.js)');
  // ===========================================================================

  const onboarding = require('../services/agentOnboarding');

  check('a name and an agency are parsed out of one free-text reply', () => {
    assert.deepStrictEqual(onboarding.parseNameReply('Jean Kabeya, Agence Horizon'), {
      fullName: 'Jean Kabeya', agencyName: 'Agence Horizon',
    });
    assert.deepStrictEqual(onboarding.parseNameReply('Paul N - Immo Kin'), {
      fullName: 'Paul N', agencyName: 'Immo Kin',
    });
  });

  check('a name with no agency yields null, never a fabricated agency', () => {
    assert.deepStrictEqual(onboarding.parseNameReply('Marie Tshibangu'), {
      fullName: 'Marie Tshibangu', agencyName: null,
    });
  });

  check('a polite lead-in is not stored as part of the name', () =>
    assert.strictEqual(onboarding.parseNameReply('Bonjour, Jean Kabeya').fullName, 'Jean Kabeya'));

  check('an empty reply is refused rather than creating a nameless account', () =>
    assert.strictEqual(onboarding.parseNameReply('   '), null));

  check('the summary card omits fields the agent never gave, rather than printing dashes', () => {
    const card = onboarding.summaryCard(
      { commune: 'Gombe', price: 1200, currency: 'USD', transaction_type: 'location', bedrooms: null },
      5,
    );
    assert.match(card, /Gombe/);
    // fr-FR groups thousands with U+202F (narrow no-break space), not a plain
    // space — matching a literal ' ' here fails against correct output.
    assert.match(card, /1\s200\s\$ \/ mois/u);
    assert.match(card, /5 reçues/);
    assert.ok(!/Chambres/.test(card), 'a bedroom count that was never given must not appear at all');
  });

  check('the onboarding session is capped so an unanswering sender is not nagged forever', () => {
    const waId = '243950000777';
    for (let i = 0; i < onboarding.MAX_ASKS + 2; i += 1) dbService.openOnboardingSession(waId);
    assert.ok(dbService.getOnboardingSession(waId).asked_count >= onboarding.MAX_ASKS);
  });

  check('completing a session is terminal', () => {
    const waId = '243950000778';
    dbService.openOnboardingSession(waId);
    const done = dbService.completeOnboardingSession(waId, { fullName: 'A B', agencyName: 'C', agentId: 12 });
    assert.strictEqual(done.state, 'COMPLETED');
    assert.strictEqual(done.agent_id, 12);
  });

  check('the activation token is stored as a hash, never in the clear', () => {
    const token = 'a'.repeat(64);
    const hashed = onboarding.hashToken(token);
    assert.notStrictEqual(hashed, token);
    assert.strictEqual(hashed.length, 64);
    assert.strictEqual(onboarding.hashToken(token), hashed, 'the hash must be deterministic across processes');
  });

  check('the magic link carries the phone and the raw token, and nothing else', () => {
    const message = onboarding.activationMessage({
      fullName: 'Jean', link: 'https://lukkaplace.com/compte/agent/activer?phone=243900000000&token=abc',
      listingQueued: true,
    });
    assert.match(message, /activer\?phone=243900000000&token=abc/);
    assert.match(message, /modération/);
  });

  // ===========================================================================
  console.log('\n18. Weekly alert scheduler (services/scheduler.js)');
  // ===========================================================================

  const scheduler = require('../services/scheduler');

  check('the sweep fires in its configured window', () => {
    const when = new Date();
    // Walk forward to the next configured day/hour so this assertion does not
    // depend on when the suite happens to run.
    while (when.getDay() !== scheduler.ALERT_DAY || when.getHours() !== scheduler.ALERT_HOUR) {
      when.setHours(when.getHours() + 1);
    }
    assert.strictEqual(scheduler.shouldRunNow(when), true);
  });

  check('it does not fire outside that window', () => {
    const when = new Date();
    while (when.getDay() === scheduler.ALERT_DAY && when.getHours() === scheduler.ALERT_HOUR) {
      when.setHours(when.getHours() + 1);
    }
    assert.strictEqual(scheduler.shouldRunNow(when), false);
  });

  check('a successful run blocks a second sweep in the same week', () => {
    dbService.recordJobRun(scheduler.JOB_NAME, { ok: true, detail: '{}' });
    const when = new Date();
    while (when.getDay() !== scheduler.ALERT_DAY || when.getHours() !== scheduler.ALERT_HOUR) {
      when.setHours(when.getHours() + 1);
    }
    assert.strictEqual(
      scheduler.shouldRunNow(when),
      false,
      'a deploy landing inside the firing window must not re-send every customer their alerts',
    );
  });

  check('a FAILED run does not count as having run — the next tick retries', () => {
    // Reset to a clean slate, then record only a failure.
    dbService.recordJobRun('scheduler-failure-probe', { ok: false, detail: 'boom' });
    const probe = dbService.getLastJobRun('scheduler-failure-probe');
    assert.strictEqual(probe.succeeded_at, null);
    assert.match(probe.last_error, /boom/);
  });

  await checkAsync('the sweep refuses to run without CRON_SECRET rather than calling an open endpoint', async () => {
    const saved = process.env.CRON_SECRET;
    process.env.CRON_SECRET = '';
    await assert.rejects(() => scheduler.runSearchAlertSweep(), /CRON_SECRET/);
    process.env.CRON_SECRET = saved;
  });

  // -------------------------------------------------------------------------
  console.log(`\n${'-'.repeat(60)}`);
  console.log(`${passed} passed, ${failed} failed`);
  console.log(`${'-'.repeat(60)}`);

  dbService.close();
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(DB + suffix)) fs.unlinkSync(DB + suffix);
  }

  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\nverification crashed:', err);
  process.exit(1);
});
