// Business rules as pure functions so they can be unit-tested on their own.
import { CONFIG } from './catalog.js';
import { HOUR, round2 } from './util.js';

/** FR-BKG-01 / FR-PAY-03: all-inclusive price the family sees, plus the split on release. */
export function priceBooking({ minCharge, qty = 1, addOns = [], discountPct = 0, trusted = false, config = CONFIG }) {
  const serviceValue = minCharge * qty;
  const addOnsValue = addOns.reduce((s, a) => s + a.price, 0) * qty;
  const gross = serviceValue + addOnsValue;
  const discount = Math.round((gross * discountPct) / 100);
  const careValue = gross - discount;
  const platformFee = config.platformFee;
  const gst = Math.round((platformFee * config.gstPct) / 100);
  const total = careValue + platformFee + gst;
  const commissionPct = trusted ? config.trustedCommissionPct : config.commissionPct;
  const commission = Math.round((careValue * commissionPct) / 100);
  return {
    serviceValue, addOnsValue, discount, discountPct, careValue, platformFee, gst, total,
    commissionPct, commission, providerShare: careValue - commission, elderlinkFee: commission + platformFee,
  };
}

/** FR-BKG-11: what the family is charged when it cancels; provider cancellations are always free. */
export function cancellationCharge({ start, now, careValue, by }) {
  if (by === 'provider') return { pct: 0, charge: 0, credit: CONFIG.providerCancelCredit };
  const hoursLeft = (start - now) / HOUR;
  let pct = 0;
  if (hoursLeft < 2) pct = 100;
  else if (hoursLeft < 12) pct = 50;
  return { pct, charge: Math.round((careValue * pct) / 100), credit: 0 };
}

export const RATING_DIMENSIONS = ['punctuality', 'skill', 'behaviour', 'hygiene', 'communication'];

export function reviewScore(ratings) {
  const vals = RATING_DIMENSIONS.map((d) => ratings[d]).filter((v) => typeof v === 'number');
  if (typeof ratings.overall === 'number' && !vals.length) return ratings.overall;
  return vals.length ? round2(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

/** FR-REV-04: senior 60%, payer 40%; if one is missing the other counts fully. */
export function visitRating(seniorScore, payerScore) {
  if (seniorScore == null && payerScore == null) return null;
  if (seniorScore == null) return payerScore;
  if (payerScore == null) return seniorScore;
  return round2(seniorScore * 0.6 + payerScore * 0.4);
}

/**
 * SRS 8.1: quality score 0-100. Inputs are rates between 0 and 1 except avgRating (1-5)
 * and complaints (count of substantiated complaints in the window).
 */
export function qualityScore({ avgRating, onTimeRate, checklistRate, repeatRate, complaints = 0, visits = 0 }, weights = CONFIG.qualityWeights) {
  if (!visits) return null;
  const ratingPart = avgRating == null ? 0.8 : (avgRating - 1) / 4;
  const complaintPart = Math.max(0, 1 - (complaints / Math.max(visits, 1)) * 5);
  const score =
    weights.reviews * ratingPart +
    weights.onTime * (onTimeRate ?? 1) +
    weights.checklist * (checklistRate ?? 1) +
    weights.repeat * Math.min(1, (repeatRate ?? 0) * 2) +
    weights.complaints * complaintPart;
  return Math.round(score);
}

/** FR-REV-10 bands. */
export function qualityBand(score) {
  if (score == null) return { key: 'new', label: 'New' };
  if (score >= 85) return { key: 'excellent', label: 'Excellent' };
  if (score >= 70) return { key: 'good', label: 'Good' };
  if (score >= 60) return { key: 'fair', label: 'Fair' };
  return { key: 'review', label: 'Under review' };
}

/** FR-LST-08: listings priced far from the city median go to a coordinator. */
export function medianFlag(minCharge, median, config = CONFIG) {
  if (!median) return null;
  const diff = ((minCharge - median) / median) * 100;
  if (diff <= -config.medianLowFlagPct) return 'low';
  if (diff >= config.medianHighFlagPct) return 'high';
  return null;
}

/**
 * FR-SRC-03: 50% quality + 20% distance + 15% price versus median + 15% availability match.
 * Returns 0-100.
 */
export function rankScore({ quality, distanceKm, radiusKm, price, median, availableSoon }) {
  const q = (quality ?? 70) / 100;
  const d = Math.max(0, 1 - distanceKm / Math.max(radiusKm, 1));
  const p = median ? Math.max(0, Math.min(1, 0.5 + (median - price) / (2 * median))) : 0.5;
  const a = availableSoon ? 1 : 0.4;
  return Math.round((q * 50 + d * 20 + p * 15 + a * 15) * 10) / 10;
}

/** FR-CHK-04 / 05: traffic light per vital and overall. */
export function vitalsStatus(v, t = CONFIG.vitalThresholds) {
  const out = {};
  const set = (k, s) => { out[k] = s; };
  if (v.bpSys != null) set('bp', v.bpSys >= t.bpSys.red || v.bpDia >= t.bpDia.red || v.bpSys < t.bpSys.low ? 'red' : v.bpSys >= t.bpSys.amber || v.bpDia >= t.bpDia.amber ? 'amber' : 'green');
  if (v.pulse != null) set('pulse', v.pulse >= t.pulse.red || v.pulse < t.pulse.low ? 'red' : v.pulse >= t.pulse.amber ? 'amber' : 'green');
  if (v.spo2 != null) set('spo2', v.spo2 < t.spo2.red ? 'red' : v.spo2 < t.spo2.amber ? 'amber' : 'green');
  if (v.temp != null) set('temp', v.temp >= t.temp.red ? 'red' : v.temp >= t.temp.amber ? 'amber' : 'green');
  if (v.sugar != null) set('sugar', v.sugar >= t.sugar.red || v.sugar < t.sugar.low ? 'red' : v.sugar >= t.sugar.amber ? 'amber' : 'green');
  const vals = Object.values(out);
  const overall = vals.includes('red') ? 'red' : vals.includes('amber') ? 'amber' : vals.length ? 'green' : null;
  return { parts: out, overall };
}

export function nextStepFor(status) {
  if (status === 'red') return 'Call the senior now and speak to the doctor today. If there is chest pain, breathlessness or confusion, press SOS.';
  if (status === 'amber') return 'Recheck within 24 hours and mention it to the doctor at the next visit.';
  return null;
}

/** FR-MED-08 adherence: Taken / (Taken + Missed + Skipped) for doses that are due. */
export function adherence(doses) {
  const due = doses.filter((d) => ['taken', 'missed', 'skipped'].includes(d.status));
  if (!due.length) return null;
  return Math.round((due.filter((d) => d.status === 'taken').length / due.length) * 100);
}

/** FR-SUB-03: pro-rata charge for an immediate upgrade. */
export function proRata({ oldPrice, newPrice, periodStart, periodEnd, now }) {
  const left = Math.max(0, periodEnd - now) / Math.max(1, periodEnd - periodStart);
  return Math.max(0, Math.round((newPrice - oldPrice) * left));
}

/** FR-REV-07: very simple fraud heuristics. */
export function reviewFraudFlags({ text, existingTexts = [], recentFiveStarCount = 0, sameDeviceAsProvider = false }) {
  const flags = [];
  const norm = (s) => String(s || '').trim().toLowerCase();
  if (text && text.length > 15 && existingTexts.some((t) => norm(t) === norm(text))) flags.push('identical_text');
  if (recentFiveStarCount >= 5) flags.push('five_star_burst');
  if (sameDeviceAsProvider) flags.push('linked_device');
  return flags;
}
