import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AD_CHANNELS, CHANNEL_COLORS, TRAFFIC_CHANNELS, bucketKeys, changePercent, chartSeries, trafficBucket, trafficChannelOf,
  trafficChannelSql,
} from '../../lib/trafficChannels.js';
import { CAMPAIGNS_SQL, CHANNEL_TOTALS_SQL, RAW_SOURCES_SQL, TAP_TOTALS_SQL, TIMELINE_SQL } from '../../lib/trafficSources.js';
import fr from '../../lib/i18n/fr.json' with { type: 'json' };
import en from '../../lib/i18n/en.json' with { type: 'json' };

// Shapes seen in production page_views (2026-11-16), with the channel each must land in.
const CASES = [
  [{ source: 'direct' }, 'direct'],
  [{ source: 'chatgpt.com' }, 'ai'],
  [{ source: 'perplexity.ai', referrerHost: 'perplexity.ai' }, 'ai'],
  [{ source: 'google.com', referrerHost: 'google.com' }, 'search'],
  [{ source: 'google.com.hk', referrerHost: 'google.com.hk' }, 'search'],
  [{ source: 'com.google.android.googlequicksearchbox', referrerHost: 'com.google.android.googlequicksearchbox' }, 'search'],
  [{ source: 'bing.com', referrerHost: 'bing.com' }, 'search'],
  // Meta ads: utm_source is Meta's placement, the campaign its id.
  [{ source: 'fb', medium: 'paid', clickIdType: 'fbclid', referrerHost: 'm.facebook.com', campaign: '120253650320780174' }, 'meta_ads_facebook'],
  [{ source: 'fb-featuredofferings', medium: 'paid' }, 'meta_ads_facebook'],
  [{ source: 'ig', medium: 'paid', campaign: '120253592222210174' }, 'meta_ads_instagram'],
  [{ source: 'an', medium: 'paid', clickIdType: 'fbclid', referrerHost: 'l.facebook.com' }, 'meta_ads_other'],
  [{ source: 'lukka_reseaux', medium: 'paid', clickIdType: 'fbclid', referrerHost: 'facebook.com' }, 'meta_ads_facebook'],
  [{ source: 'lukka_reseaux', clickIdType: 'fbclid', referrerHost: 'l.instagram.com', campaign: '120253801995520174' }, 'meta_ads_instagram'],
  // fbclid alone is Facebook, not an ad: Facebook adds it to every outbound link.
  [{ source: 'lukka_reseaux', clickIdType: 'fbclid', referrerHost: 'm.facebook.com' }, 'facebook'],
  [{ source: 'facebook', clickIdType: 'fbclid' }, 'facebook'],
  [{ source: 'facebook.com', referrerHost: 'facebook.com' }, 'facebook'],
  [{ source: 'ig', medium: 'social', clickIdType: 'fbclid', referrerHost: 'l.instagram.com' }, 'instagram'],
  [{ source: 'tiktok', medium: 'bio', campaign: 'lancement_mrphine' }, 'tiktok'],
  [{ source: 'tiktok.com', referrerHost: 'tiktok.com' }, 'tiktok'],
  [{ source: 'tiktok', clickIdType: 'ttclid' }, 'tiktok_ads'],
  [{ source: 'google', clickIdType: 'gclid' }, 'google_ads'],
  [{ source: 'agent', medium: 'partner' }, 'agents'],
  [{ source: 'wa_status' }, 'agents'],
  [{ source: 'whatsapp', medium: 'guide' }, 'whatsapp'],
  [{ source: 'alerte_whatsapp' }, 'whatsapp'],
  [{ source: 'lukka_reseaux' }, 'other_social'],
  [{ source: 't.co', referrerHost: 't.co' }, 'other_social'],
  [{ source: 'ntp.msn.com', referrerHost: 'ntp.msn.com' }, 'other'],
  [{ source: null }, 'direct'],
];

test('each production attribution shape lands in its channel', () => {
  for (const [row, expected] of CASES) {
    assert.equal(trafficChannelOf(row), expected, JSON.stringify(row));
  }
});

test('every channel has a colour and both dictionaries name it', () => {
  for (const channel of TRAFFIC_CHANNELS) {
    assert.ok(CHANNEL_COLORS[channel], channel);
    assert.ok(fr.admin.trafficSources.channels[channel], `fr ${channel}`);
    assert.ok(en.admin.trafficSources.channels[channel], `en ${channel}`);
  }
  for (const channel of AD_CHANNELS) assert.ok(TRAFFIC_CHANNELS.includes(channel));
});

test('the SQL CASE returns only known channels, in the same rule order', () => {
  const sql = trafficChannelSql({ source: 's', medium: 'm', clickIdType: 'c', referrerHost: 'h', campaign: 'k' });
  const returned = [...sql.matchAll(/THEN '([a-z_]+)'|ELSE '([a-z_]+)'/g)].map((m) => m[1] || m[2]);
  for (const channel of returned) assert.ok(TRAFFIC_CHANNELS.includes(channel), channel);
  // Ads before AI before organic, as in trafficChannelOf.
  const order = ['google_ads', 'tiktok_ads', 'meta_ads_instagram', 'ai', 'instagram', 'facebook', 'tiktok', 'search', 'agents', 'whatsapp', 'other_social', 'direct'];
  const at = order.map((channel) => sql.indexOf(`THEN '${channel}'`));
  for (let i = 1; i < at.length; i += 1) {
    assert.ok(at[i - 1] >= 0 && at[i - 1] < at[i], `${order[i - 1]} before ${order[i]}`);
  }
  assert.ok(sql.includes("'^[0-9]{12,}$'"), 'Meta campaign ids count as ads');
});

test('every query counts people only and reads two windows', () => {
  for (const sql of [CHANNEL_TOTALS_SQL, TIMELINE_SQL, CAMPAIGNS_SQL, RAW_SOURCES_SQL]) {
    assert.match(sql, /viewer_kind', 'visitor'\) = 'visitor'/);
    assert.match(sql, /\$1::int \* 2/);
  }
  assert.match(TAP_TOTALS_SQL, /FROM whatsapp_clicks w/);
  assert.match(TAP_TOTALS_SQL, /COALESCE\(to_jsonb\(w\) ->> 'viewer_kind', 'visitor'\) = 'visitor'/);
  assert.match(TAP_TOTALS_SQL, /p\.visitor_id = w\.visitor_id/);
  assert.match(TIMELINE_SQL, /AT TIME ZONE 'Africa\/Kinshasa'/);
});

test('changePercent never invents a rate', () => {
  assert.equal(changePercent(10, null), null);
  assert.equal(changePercent(10, 0), null);
  assert.equal(changePercent(15, 10), 50);
  assert.equal(changePercent(5, 10), -50);
});

test('chart series keep the biggest channels and fold the rest', () => {
  const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((channel, i) => ({ channel, visitors: 10 - i }));
  assert.deepEqual(chartSeries(rows), { shown: ['a', 'b', 'c', 'd', 'e', 'f'], folded: true });
  assert.deepEqual(chartSeries([{ channel: 'x', visitors: 0 }]), { shown: [], folded: false });
});

test('chart buckets cover the whole period in Kinshasa time', () => {
  const now = Date.parse('2026-11-16T10:30:00Z'); // 11:30 in Kinshasa
  assert.equal(trafficBucket(1), 'hour');
  assert.equal(trafficBucket(14), 'day');
  assert.equal(trafficBucket(null), 'week');
  const hours = bucketKeys({ bucket: 'hour', days: 1, rows: [], now });
  assert.equal(hours.length, 25);
  assert.equal(hours.at(-1), '2026-11-16T11:00');
  const daysKeys = bucketKeys({ bucket: 'day', days: 3, rows: [], now });
  assert.deepEqual(daysKeys, ['2026-11-13T00:00', '2026-11-14T00:00', '2026-11-15T00:00', '2026-11-16T00:00']);
  const weeks = bucketKeys({ bucket: 'week', days: null, rows: [{ bucket: '2026-10-26T00:00' }], now });
  assert.deepEqual(weeks, ['2026-10-26T00:00', '2026-11-02T00:00', '2026-11-09T00:00', '2026-11-16T00:00']);
});
