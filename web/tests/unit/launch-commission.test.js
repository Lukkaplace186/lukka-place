import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACQUISITION_TIERS, ADDITIONAL_TIERS, acquisitionTier, additionalListings, additionalTier, fortnightRange, launchSummary,
  linesReached, normaliseReferralCode, qualityResult, recentFortnights, suggestReferralCode, tierDeltas,
} from '@/lib/launchCommission';

// ---------------------------------------------------------------------------
// The policy's own worked examples (§8)
// ---------------------------------------------------------------------------

test('Example A: 5 qualified agents, exactly 15 confirmed listings → $15, no listing bonus', () => {
  const s = launchSummary({ qualified: 5, totalConfirmed: 15 });
  assert.equal(s.acquisition.amount, 15);
  assert.equal(s.additional.count, 0);
  assert.equal(s.additional.amount, 0);
  assert.equal(s.earned, 15);
});

test('Example B: 10 qualified agents, 40 listings → $35 + $5 = $40', () => {
  const s = launchSummary({ qualified: 10, totalConfirmed: 40 });
  assert.equal(s.additional.count, 10);
  assert.deepEqual([s.acquisition.amount, s.additional.amount, s.earned], [35, 5, 40]);
});

test('Example C: 20 qualified agents, 95 listings → 35 additional → $90 + $15 = $105', () => {
  const s = launchSummary({ qualified: 20, totalConfirmed: 95 });
  assert.equal(s.additional.count, 35);
  assert.deepEqual([s.acquisition.amount, s.additional.amount, s.earned], [90, 15, 105]);
});

test('Example D: 50 qualified agents, 250 listings, quality passed → $300 + $80 + $25 = $405', () => {
  const s = launchSummary({ qualified: 50, totalConfirmed: 250, quality: { checked: 200, valid: 180 } });
  assert.equal(s.additional.count, 100);
  assert.deepEqual([s.acquisition.amount, s.additional.amount, s.quality.amount, s.earned], [300, 80, 25, 405]);
  assert.equal(s.acquisition.next, null, '50 is the top tier');
});

// ---------------------------------------------------------------------------
// Tiers are milestones, not rates
// ---------------------------------------------------------------------------

test('additional listings use step thresholds: 37 earns the 25 tier, 49 still does, 50 moves up', () => {
  assert.equal(additionalTier(37).amount, 15);
  assert.equal(additionalTier(49).amount, 15);
  assert.equal(additionalTier(50).amount, 35);
  assert.equal(additionalTier(9).amount, 0);
  assert.deepEqual(additionalTier(9).next, { at: 10, amount: 5, missing: 1 });
});

test('below the first tier nothing is earned, and the next milestone says how far it is', () => {
  assert.deepEqual(acquisitionTier(4), { amount: 0, reached: null, next: { at: 5, amount: 15, missing: 1 } });
  assert.deepEqual(acquisitionTier(20).next, { at: 30, amount: 150, missing: 10 }, '§11.4: 20 agents → 10 more for $150');
  assert.equal(acquisitionTier(-3).amount, 0);
  assert.equal(acquisitionTier('12').amount, 35);
});

test('baseline listings of qualified agents are never a bonus, and never negative', () => {
  assert.equal(additionalListings(15, 5), 0);
  assert.equal(additionalListings(10, 5), 0, 'fewer listings than the baseline is zero, not negative');
  assert.equal(additionalListings(40, 10), 10);
});

test('ledger lines hold each tier’s delta, so their sum is always the cumulative amount', () => {
  const deltas = tierDeltas(ACQUISITION_TIERS);
  assert.deepEqual(deltas.map((d) => d.delta), [15, 20, 25, 30, 60, 70, 80]);
  for (const [threshold, total] of ACQUISITION_TIERS) {
    const sum = linesReached(ACQUISITION_TIERS, threshold).reduce((acc, line) => acc + line.delta, 0);
    assert.equal(sum, total, `${threshold} agents`);
  }
  assert.deepEqual(tierDeltas(ADDITIONAL_TIERS).map((d) => d.delta), [5, 10, 20, 45]);
});

test('paid at 5 agents, reaching 10 leaves only the $20 difference to pay', () => {
  const s = launchSummary({ qualified: 10, totalConfirmed: 30, paid: 15 });
  assert.equal(s.earned, 35);
  assert.equal(s.outstanding, 20);
  const newLines = linesReached(ACQUISITION_TIERS, 10).filter((line) => line.threshold > 5);
  assert.deepEqual(newLines, [{ threshold: 10, delta: 20 }]);
});

// ---------------------------------------------------------------------------
// 30-day quality bonus
// ---------------------------------------------------------------------------

test('quality needs at least 15 checked listings and 80% of them valid', () => {
  assert.equal(qualityResult({ checked: 14, valid: 14 }).passed, false, '1 of 1 cannot earn it');
  assert.equal(qualityResult({ checked: 14, valid: 14 }).eligible, false);
  assert.equal(qualityResult({ checked: 15, valid: 12 }).passed, true, 'exactly 80%');
  assert.equal(qualityResult({ checked: 15, valid: 11 }).passed, false);
  assert.equal(qualityResult({ checked: 15, valid: 99 }).valid, 15, 'valid never exceeds checked');
});

test('the quality bonus already on the ledger keeps counting even if the ratio later dips', () => {
  const s = launchSummary({ qualified: 5, totalConfirmed: 15, quality: { checked: 20, valid: 10 }, qualityEarned: true });
  assert.equal(s.quality.amount, 25);
});

// ---------------------------------------------------------------------------
// Referral codes and fortnights
// ---------------------------------------------------------------------------

test('a referral code is 3–10 letters then 2 digits, uppercased', () => {
  assert.equal(normaliseReferralCode('jean01'), 'JEAN01');
  assert.equal(normaliseReferralCode(' JEAN-01 '), 'JEAN01');
  assert.equal(normaliseReferralCode('LUKKA-JEAN'), null);
  assert.equal(normaliseReferralCode('JE01'), null);
  assert.equal(normaliseReferralCode('JEAN001'), null);
  assert.equal(normaliseReferralCode("JEAN01'; DROP"), null);
});

test('a suggested code comes from the first usable name and skips codes in use', () => {
  assert.equal(suggestReferralCode('Jean Kabeya'), 'JEAN01');
  assert.equal(suggestReferralCode('Jean Kabeya', ['JEAN01', 'jean02']), 'JEAN03');
  assert.equal(suggestReferralCode('Ngalula Élodie'), 'NGALULA01');
  assert.equal(suggestReferralCode('Hélène'), 'HELENE01', 'accents folded');
  assert.equal(suggestReferralCode('Jo Mbuyi'), 'MBUYI01', 'a 2-letter first name is skipped');
  assert.equal(suggestReferralCode('42'), null);
});

test('fortnights are 1–15 and 16–end of month in Kinshasa time', () => {
  assert.deepEqual(fortnightRange('2026-09-1'), { from: '2026-08-31T23:00:00.000Z', to: '2026-09-15T23:00:00.000Z' });
  assert.deepEqual(fortnightRange('2026-12-2'), { from: '2026-12-15T23:00:00.000Z', to: '2026-12-31T23:00:00.000Z' });
  assert.equal(fortnightRange('2026-13-1'), null);
  assert.equal(fortnightRange('bogus'), null);
  // 23:30 UTC on the 15th is already the 16th in Kinshasa.
  assert.deepEqual(recentFortnights(new Date('2026-09-15T23:30:00Z'), 3), ['2026-09-2', '2026-09-1', '2026-08-2']);
  assert.deepEqual(recentFortnights(new Date('2026-01-05T10:00:00Z'), 2), ['2026-01-1', '2025-12-2']);
});
