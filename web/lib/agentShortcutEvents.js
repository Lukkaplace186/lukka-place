/**
 * Shared identifiers between AgentKeyboardShortcuts.js (dispatches/sets
 * these) and CreateListingDialog.js (listens/reads them) — kept in one tiny
 * module rather than duplicating the literal strings in both files, where a
 * typo in one would silently break the shortcut with no error anywhere.
 */
export const OPEN_CREATE_LISTING_EVENT = 'agent:open-create-listing';
export const OPEN_CREATE_LISTING_STORAGE_KEY = 'agent-open-create-listing';
