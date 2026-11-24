/**
 * Pure grouping for the app's chat (components/chat/AppChatList.js).
 */

/**
 * Consecutive messages from one person form a group; a day divider or a
 * system line ends it. Pure, so the grouping is tested on its own.
 *
 * @returns {Array<{ type: 'divider'|'system', key, label }|{ type: 'group', key, mine, rows }>}
 */
export function groupChatRows(rows, side) {
  const out = [];
  for (const row of rows) {
    const { message, divider } = row;
    if (divider) out.push({ type: 'divider', key: `d-${message.clientId || message.id}`, label: divider });
    if (message.kind === 'system') {
      out.push({ type: 'system', key: `s-${message.clientId || message.id}`, label: message.body });
      continue;
    }
    const mine = message.senderRole === side;
    const last = out[out.length - 1];
    if (last?.type === 'group' && last.mine === mine && !divider) last.rows.push(row);
    else out.push({ type: 'group', key: `g-${message.clientId || message.id}`, mine, rows: [row] });
  }
  return out;
}
