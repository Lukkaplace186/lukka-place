/**
 * Which channel brought an account (growth plan item 21) — one definition,
 * shared by /admin/croissance, the owners' morning summary and the tests.
 * Pure. Read from `account_acquisitions` (lib/accountAcquisition.js): the
 * partner first, then the LAST touch, then the first.
 *
 *   agents / createurs / campagnes   a partner's code credited the account
 *   meta_ads / tiktok_ads            a paid click (ad click id, or utm_medium paid/cpc)
 *   reseaux                          Facebook, Instagram, TikTok, YouTube, WhatsApp, unpaid
 *   recherche                        Google, Bing
 *   whatsapp_inscription             the account was created on WhatsApp
 *   direct                           a typed address, a bookmark
 *   autre                            any other site or tag
 *   inconnu                          no acquisition row (before tracking, or a lost write)
 */

export const CHANNELS = [
  'meta_ads', 'tiktok_ads', 'createurs', 'agents', 'campagnes', 'reseaux', 'recherche',
  'whatsapp_inscription', 'direct', 'autre', 'inconnu',
];

export const PAID_CHANNELS = { meta_ads: 'meta_ads', tiktok_ads: 'tiktok_ads' };

const META_SOURCES = new Set(['facebook', 'instagram', 'fb', 'ig', 'meta', 'facebook.com', 'instagram.com', 'm.facebook.com', 'l.facebook.com', 'lm.facebook.com', 'l.instagram.com']);
const TIKTOK_SOURCES = new Set(['tiktok', 'tiktok.com', 'vm.tiktok.com']);
const SOCIAL_SOURCES = new Set([...META_SOURCES, ...TIKTOK_SOURCES, 'youtube', 'youtube.com', 'whatsapp', 'wa_status', 'wa_message', 'partage_agent', 'reseaux_sociaux', 'lukka_reseaux', 't.co', 'twitter', 'x.com', 'linkedin']);
const SEARCH_SOURCES = new Set(['google', 'google.com', 'google.cd', 'bing', 'bing.com', 'duckduckgo.com', 'yahoo.com']);
const PAID_MEDIUMS = new Set(['paid', 'cpc', 'ppc', 'ads', 'paid_social']);

/**
 * @param {{channel?: string|null, partnerKind?: string|null, source?: string|null, medium?: string|null,
 *          clickIdType?: string|null, hasAcquisition?: boolean}} row
 */
export function channelOf(row) {
  if (!row || row.hasAcquisition === false) return 'inconnu';
  if (row.partnerKind === 'agent') return 'agents';
  if (row.partnerKind === 'creator') return 'createurs';
  if (row.partnerKind === 'campaign') return 'campagnes';
  if (row.channel === 'whatsapp') return 'whatsapp_inscription';
  if (row.channel === 'admin') return 'autre';
  const source = String(row.source || '').toLowerCase();
  const medium = String(row.medium || '').toLowerCase();
  const paid = PAID_MEDIUMS.has(medium) || row.clickIdType === 'fbclid' || row.clickIdType === 'ttclid';
  if (paid && (row.clickIdType === 'fbclid' || META_SOURCES.has(source))) return 'meta_ads';
  if (paid && (row.clickIdType === 'ttclid' || TIKTOK_SOURCES.has(source))) return 'tiktok_ads';
  if (!source || source === 'direct') return 'direct';
  if (source === 'influencer') return 'createurs';
  if (source === 'agent') return 'agents';
  if (SOCIAL_SOURCES.has(source)) return 'reseaux';
  if (SEARCH_SOURCES.has(source) || row.clickIdType === 'gclid') return 'recherche';
  return 'autre';
}

/**
 * Cost per account for each paid channel: the spend typed in for the weeks of
 * the period, divided by the accounts that channel brought in it. Per
 * currency; null when there were no accounts (never "0 $" or infinity).
 */
export function paidChannelCosts(spendRows, accountsByChannel) {
  const out = {};
  for (const channel of Object.keys(PAID_CHANNELS)) {
    const spend = {};
    for (const row of spendRows || []) {
      if (row.channel !== channel) continue;
      spend[row.currency] = Math.round(((spend[row.currency] || 0) + Number(row.amount || 0)) * 100) / 100;
    }
    const accounts = Number(accountsByChannel?.[channel] || 0);
    out[channel] = {
      spend,
      accounts,
      perAccount: Object.fromEntries(Object.entries(spend).map(([currency, amount]) => [
        currency, accounts > 0 ? Math.round((amount / accounts) * 100) / 100 : null,
      ])),
    };
  }
  return out;
}

/** The Monday of the week a day falls in, as YYYY-MM-DD (weeks for ad spend and creator figures). */
export function weekStart(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

/**
 * The owners' morning WhatsApp (growth plan item 22), in French.
 * @param {{day: string, customers: number, agents: number, byChannel: Record<string, number>,
 *          visitors: number|null, topAgent: {name, n}|null, topCreator: {name, n}|null}} summary
 */
export function dailySummaryText(summary, channelLabels) {
  const parts = Object.entries(summary.byChannel || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([channel, n]) => `${channelLabels[channel] || channel} ${n}`);
  const lines = [
    `Lukka Place — ${summary.day}`,
    `${summary.customers} compte(s) client${parts.length ? ` : ${parts.join(', ')}` : ''}.`,
    `${summary.agents} nouvel(s) agent(s).`,
  ];
  if (summary.visitors != null) lines.push(`${summary.visitors} visiteur(s).`);
  if (summary.topAgent) lines.push(`Meilleur agent : ${summary.topAgent.name} (${summary.topAgent.n}).`);
  if (summary.topCreator) lines.push(`Meilleur créateur : ${summary.topCreator.name} (${summary.topCreator.n}).`);
  return lines.join('\n');
}

/** French channel names for the summary (the console uses the dictionaries). */
export const CHANNEL_LABELS_FR = {
  meta_ads: 'Pub Meta',
  tiktok_ads: 'Pub TikTok',
  createurs: 'Créateurs',
  agents: 'Agents',
  campagnes: 'Campagnes',
  reseaux: 'Réseaux',
  recherche: 'Recherche',
  whatsapp_inscription: 'WhatsApp',
  direct: 'Direct',
  autre: 'Autre',
  inconnu: 'Inconnu',
};
