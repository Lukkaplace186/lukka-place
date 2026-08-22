/**
 * services/buyerConversation.js
 *
 * Orchestrates ONE inbound customer-search WhatsApp message through the
 * buyer assistant (services/openai.js's runBuyerTurn) end to end: load or
 * create the conversation, respect human handoff (product spec §17 — the AI
 * stays silent once a human has taken over), run the assistant, persist the
 * transcript, merge real requirements out of the tool calls the model
 * actually made (no second extraction call needed — search_properties's own
 * arguments ARE the structured requirements), and send the reply via Chakra.
 *
 * Kept as its own module rather than inlined in routes/webhook.js so that
 * file's new branch stays a handful of lines — see its own doc comment.
 */

const db = require('./db');
const { runBuyerTurn, BUYER_ASSISTANT_FALLBACK_REPLY } = require('./openai');
const chakra = require('./chakra');

const HISTORY_LIMIT = 10;

/** search_properties tool-call argument keys that double as real conversation requirement fields (same names, by design — see services/openai.js's BUYER_TOOLS). */
const REQUIREMENT_ARG_KEYS = [
  'transaction_type', 'property_type', 'commune', 'quartier', 'price_min', 'price_max', 'bedrooms',
];

/** Best-effort state nudge — never fatal. An invalid transition (conversation already further along, or terminal) just leaves the state as it is. */
function tryTransition(conversationId, targetState) {
  try {
    db.updateConversationState(conversationId, targetState);
  } catch (err) {
    console.log(`[buyer] conversation #${conversationId}: state transition to ${targetState} skipped (${err.message})`);
  }
}

/**
 * The customer's own words, as captured in the arguments the model chose
 * for its LAST search_properties call, become the conversation's stored
 * requirements — real, model-interpreted data, not a guess made here.
 */
function mergeRequirementsFromToolCalls(conversationId, toolCalls) {
  const searchCalls = toolCalls.filter((c) => c.name === 'search_properties');
  if (searchCalls.length === 0) return;

  let args;
  try {
    args = JSON.parse(searchCalls[searchCalls.length - 1].arguments || '{}');
  } catch {
    return;
  }

  const patch = {};
  for (const key of REQUIREMENT_ARG_KEYS) {
    if (args[key] !== undefined && args[key] !== null) patch[key] = args[key];
  }
  if (Object.keys(patch).length > 0) {
    db.updateConversationRequirements(conversationId, patch);
  }
}

/** So a follow-up like "le premier" / "combien coûte le deuxième ?" can resolve without a reference number. */
function updateLastShownProperties(conversationId, toolCalls) {
  const lastSearch = [...toolCalls].reverse().find((c) => c.name === 'search_properties');
  if (!lastSearch || !Array.isArray(lastSearch.result?.properties)) return;
  db.setLastShownProperties(conversationId, lastSearch.result.properties.map((p) => p.id));
}

/**
 * @param {Object} params
 * @param {string} params.from          Sender's WhatsApp id (E.164, no '+').
 * @param {string} params.text          Raw message text.
 * @param {string} [params.primaryWamid]
 */
async function handleBuyerMessage({ from, text, primaryWamid }) {
  const conversation = db.getActiveConversation(from) || db.createConversation(from);

  if (!conversation.ai_active) {
    // A human agent has taken over this conversation (§17) — still record
    // the message so the agent sees the full transcript, but the AI stays
    // silent until explicitly reactivated. No WhatsApp reply is sent here.
    db.recordMessage(conversation.id, 'inbound', { wamid: primaryWamid, text });
    console.log(`[buyer] conversation #${conversation.id} (${from}) is under human handoff — AI reply skipped`);
    return;
  }

  // Fetched BEFORE recording this message: runBuyerTurn takes the new
  // message separately as `userMessage`, so `history` here is prior turns only.
  const history = db.getRecentMessages(conversation.id, HISTORY_LIMIT);
  db.recordMessage(conversation.id, 'inbound', { wamid: primaryWamid, text });

  if (conversation.state === 'NEW') {
    tryTransition(conversation.id, 'COLLECTING_REQUIREMENTS');
  }

  let reply;
  let toolCalls = [];
  try {
    ({ reply, toolCalls } = await runBuyerTurn({
      conversationId: conversation.id,
      waId: from,
      requirements: {
        transaction_type: conversation.transaction_type,
        property_type: conversation.property_type,
        commune: conversation.commune,
        quartier: conversation.quartier,
        price_min: conversation.price_min,
        price_max: conversation.price_max,
        bedrooms: conversation.bedrooms,
      },
      history,
      userMessage: text,
      selectedPropertyId: conversation.selected_property_id,
    }));
  } catch (err) {
    // Never leave the customer without a reply (product spec §53) and never
    // surface a stack trace — the same honest fallback runBuyerTurn itself
    // uses when its own tool-call loop gets stuck.
    console.error(`[buyer] conversation #${conversation.id}: runBuyerTurn failed (${err.message})`);
    reply = BUYER_ASSISTANT_FALLBACK_REPLY;
  }

  mergeRequirementsFromToolCalls(conversation.id, toolCalls);
  updateLastShownProperties(conversation.id, toolCalls);

  if (toolCalls.some((c) => c.name === 'search_properties')) {
    // The search itself already completed synchronously inside the tool
    // loop above — SEARCHING_PROPERTIES has no independent async existence
    // here, but conversationState.js's transition table (correctly) still
    // requires passing through it on the way to SHOWING_RESULTS.
    tryTransition(conversation.id, 'SEARCHING_PROPERTIES');
    tryTransition(conversation.id, 'SHOWING_RESULTS');
  }

  db.recordMessage(conversation.id, 'outbound', { text: reply });

  await chakra.sendWhatsAppMessage(from, reply, { replyToMessageId: primaryWamid || undefined });
  console.log(`[buyer] conversation #${conversation.id}: replied to ${from} (${toolCalls.length} tool call(s))`);
}

module.exports = { handleBuyerMessage };
