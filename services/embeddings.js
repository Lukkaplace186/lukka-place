/**
 * services/embeddings.js
 *
 * Semantic-search groundwork: turns a listing row into a real embedding
 * vector, for `services/postgres.js`'s `syncListingToPostgres` to persist
 * into `properties.embedding` (see scripts/setup-pgvector.js for the
 * schema). No query path reads this yet — this module only produces the
 * data, on the assumption that having it from day one is worth the small,
 * predictable cost as the catalog grows toward its 100k+ target.
 *
 * Model: text-embedding-3-small (1536 dimensions) — see scripts/setup-
 * pgvector.js's header comment for why.
 */

const { getClient } = require('./openai');
const { buildTitle, buildAddress, buildDescription } = require('./postgres');

const EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * Real text only, built entirely from the same fields buildTitle/
 * buildAddress/buildDescription already derive from a real, parsed listing
 * row (services/postgres.js) — no new fabrication, no separate "summary for
 * search" invented on top of what the listing actually says.
 *
 * @param {Object} row A parsed listing row (services/db.js getListing() shape).
 * @returns {string}
 */
function buildEmbeddingInput(row) {
  return [buildTitle(row), buildAddress(row), buildDescription(row)].filter(Boolean).join(' ');
}

/**
 * @param {string} text
 * @returns {Promise<number[]>} A 1536-element embedding vector.
 */
async function generateEmbedding(text) {
  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}

module.exports = {
  EMBEDDING_MODEL,
  buildEmbeddingInput,
  generateEmbedding,
};
