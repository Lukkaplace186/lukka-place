// Rules for the app's Activité tab (app/(site)/activite/page.js), kept pure
// so they are tested without a session or the engine.
import { kinshasaDayKey } from './visitAgenda';

/**
 * The visit the tab leads with: the one that needs the customer first, then
 * the soonest. `groups` is groupCustomerVisits' output; `answer` the visits
 * waiting on the customer (a new time proposed by the agent). Null when the
 * customer has no open visit — a past or cancelled one is history, not news.
 */
export function leadVisit(groups, answer = []) {
  if (!groups) return null;
  return answer[0] || groups.today?.[0] || groups.tomorrow?.[0] || groups.upcoming?.[0] || groups.unscheduled?.[0] || null;
}

/**
 * The four steps under the lead visit, from what the visit row says and
 * nothing else: asked, confirmed by the agent, the visit itself, the
 * customer's word on it. `state` is 'done' | 'current' | 'upcoming'.
 */
export function visitSteps(visit) {
  const tone = visit?.tone;
  const confirmed = tone === 'confirmed' || tone === 'done';
  const visited = tone === 'done';
  const reviewed = Boolean(visit?.checkinResponse);
  return [
    { key: 'requested', state: 'done' },
    { key: 'confirmed', state: confirmed ? 'done' : 'current' },
    { key: 'visit', state: visited ? 'done' : confirmed ? 'current' : 'upcoming' },
    { key: 'feedback', state: reviewed ? 'done' : visited ? 'current' : 'upcoming' },
  ];
}

/**
 * The feed, newest first, cut into days on Kinshasa's calendar:
 * [{ day: 'today' | 'yesterday' | 'YYYY-MM-DD', items }]. Order inside a day
 * is the inbox's own.
 */
export function groupByDay(items = [], now = new Date()) {
  const today = kinshasaDayKey(now);
  const yesterday = kinshasaDayKey(new Date(now).getTime() - 24 * 3600 * 1000);
  const groups = [];
  for (const item of items) {
    const key = kinshasaDayKey(item.createdAt);
    const day = key === today ? 'today' : key === yesterday ? 'yesterday' : key;
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}
