import test from 'node:test';
import assert from 'node:assert/strict';
import { priceBooking, cancellationCharge, reviewScore, visitRating, qualityScore, qualityBand, medianFlag, vitalsStatus, adherence, proRata, reviewFraudFlags } from '../core/rules.js';

test('price: GST applies only to the platform fee; commission comes out of the provider share', () => {
  const p = priceBooking({ minCharge: 600, addOns: [{ name: 'Dressing kit', price: 150 }] });
  assert.equal(p.careValue, 750);
  assert.equal(p.platformFee, 49);
  assert.equal(p.gst, 9);
  assert.equal(p.total, 808);
  assert.equal(p.commission, 113);
  assert.equal(p.providerShare, 637);
});

test('price: trusted providers pay 10% and plan discounts reduce the care value', () => {
  const p = priceBooking({ minCharge: 1000, discountPct: 5, trusted: true });
  assert.equal(p.careValue, 950);
  assert.equal(p.commission, 95);
});

test('cancellation: free over 12 h, 50% inside 12 h, 100% inside 2 h, providers never charged', () => {
  const now = 0, H = 3600e3;
  assert.equal(cancellationCharge({ start: 13 * H, now, careValue: 1000 }).charge, 0);
  assert.equal(cancellationCharge({ start: 6 * H, now, careValue: 1000 }).charge, 500);
  assert.equal(cancellationCharge({ start: 1 * H, now, careValue: 1000 }).charge, 1000);
  assert.equal(cancellationCharge({ start: 1 * H, now, careValue: 1000, by: 'provider' }).charge, 0);
});

test('reviews: senior counts 60%, payer 40%, either alone counts fully', () => {
  assert.equal(reviewScore({ punctuality: 5, skill: 4, behaviour: 5, hygiene: 4, communication: 5 }), 4.6);
  assert.equal(visitRating(5, 3), 4.2);
  assert.equal(visitRating(null, 3), 3);
  assert.equal(visitRating(4, null), 4);
});

test('quality score and bands', () => {
  const top = qualityScore({ avgRating: 5, onTimeRate: 1, checklistRate: 1, repeatRate: 1, complaints: 0, visits: 20 });
  assert.equal(top, 100);
  assert.equal(qualityScore({ visits: 0 }), null);
  assert.equal(qualityBand(90).key, 'excellent');
  assert.equal(qualityBand(72).key, 'good');
  assert.equal(qualityBand(61).key, 'fair');
  assert.equal(qualityBand(40).key, 'review');
});

test('median price flags', () => {
  assert.equal(medianFlag(300, 600), 'low');
  assert.equal(medianFlag(1300, 600), 'high');
  assert.equal(medianFlag(650, 600), null);
});

test('vitals traffic lights', () => {
  assert.equal(vitalsStatus({ bpSys: 128, bpDia: 80, spo2: 98 }).overall, 'green');
  assert.equal(vitalsStatus({ bpSys: 155, bpDia: 92 }).overall, 'amber');
  assert.equal(vitalsStatus({ spo2: 88 }).overall, 'red');
});

test('adherence ignores doses not yet due', () => {
  assert.equal(adherence([{ status: 'taken' }, { status: 'missed' }, { status: 'taken' }, { status: 'due' }]), 67);
  assert.equal(adherence([{ status: 'due' }]), null);
});

test('pro-rata upgrade charges the remaining fraction of the difference', () => {
  assert.equal(proRata({ oldPrice: 999, newPrice: 2499, periodStart: 0, periodEnd: 100, now: 50 }), 750);
});

test('review fraud heuristics flag copied text', () => {
  assert.ok(reviewFraudFlags({ text: 'Very good nurse, came on time and was very kind', existingTexts: ['Very good nurse, came on time and was very kind'] }).length > 0);
  assert.equal(reviewFraudFlags({ text: 'Helped Amma with the dressing and explained everything.' }).length, 0);
});
