// FR-PAY: all money is modelled as held by an RBI-authorised payment aggregator (mocked).
// ElderLink only records captures into escrow, releases, splits, payouts and refunds.
import { DAY } from './util.js';
import { config } from './context.js';

export function creditBalance(db, userId) {
  const now = db.now();
  return db.filter('credits', (c) => c.userId === userId && (!c.expiresAt || c.expiresAt > now)).reduce((s, c) => s + c.amount, 0);
}

export function addCredit(db, userId, amount, reason) {
  return db.insert('credits', { userId, amount, reason, expiresAt: amount > 0 ? db.now() + 365 * DAY : null }, 'crd');
}

/** Capture a payment into escrow. method: upi | card | netbanking | wallet | mandate | credit */
export function capture(db, { userId, seniorId, amount, purpose, method = 'upi', bookingId, subscriptionId, useCredit = false, mandateId }) {
  let fromCredit = 0;
  if (useCredit) {
    fromCredit = Math.min(creditBalance(db, userId), amount);
    if (fromCredit > 0) addCredit(db, userId, -fromCredit, `Used on ${purpose}`);
  }
  const gatewayRef = 'pay_' + Math.random().toString(36).slice(2, 12);
  return db.insert('payments', {
    userId, seniorId, amount, fromCredit, charged: amount - fromCredit, purpose, method, bookingId, subscriptionId, mandateId,
    gatewayRef, status: bookingId ? 'escrow' : 'captured', capturedAt: db.now(),
  }, 'pmt');
}

/** FR-PAY-03 / 04: split on release and queue the payout for T+2. */
export function release(db, booking) {
  const pay = db.get('payments', booking.paymentId);
  if (!pay || pay.status !== 'escrow') return null;
  pay.status = 'released';
  pay.releasedAt = db.now();
  const p = booking.price;
  const payout = db.insert('payouts', {
    providerId: booking.providerId, caregiverId: booking.caregiverId, bookingId: booking.id, gross: p.careValue,
    commission: p.commission, tds: Math.round(p.providerShare * 0.01), amount: p.providerShare - Math.round(p.providerShare * 0.01),
    status: 'scheduled', dueAt: db.now() + config(db).payoutDays * DAY,
  }, 'pyo');
  issueInvoices(db, booking);
  db.dirty = true;
  return payout;
}

export function refund(db, { payment, amount, reason, toCredit = false }) {
  if (!payment || amount <= 0) return null;
  const rf = db.insert('refunds', {
    paymentId: payment.id, userId: payment.userId, bookingId: payment.bookingId, amount, reason,
    method: toCredit ? 'ElderLink credit (instant)' : `Original method (${payment.method})`,
    status: toCredit ? 'done' : 'processing', etaDays: toCredit ? 0 : 5,
  }, 'rfd');
  if (toCredit) addCredit(db, payment.userId, amount, `Refund: ${reason}`);
  payment.refunded = (payment.refunded || 0) + amount;
  payment.status = payment.refunded >= payment.amount ? 'refunded' : 'part_refunded';
  db.dirty = true;
  return rf;
}

/** FR-PAY-07 / REG-17: one invoice from the provider for care, one from ElderLink for its fee. */
export function issueInvoices(db, booking) {
  if (db.find('invoices', (i) => i.bookingId === booking.id)) return;
  const p = booking.price;
  const provider = db.get('providers', booking.providerId);
  const n = db.all('invoices').length + 1;
  db.insert('invoices', {
    bookingId: booking.id, seniorId: booking.seniorId, number: `PRV/${new Date(db.now()).getUTCFullYear()}/${String(n).padStart(5, '0')}`,
    issuer: provider?.name, issuerGstin: provider?.gstin || 'Not registered (exempt healthcare service)', kind: 'provider',
    lines: [{ text: booking.serviceName, amount: p.serviceValue }, ...(booking.addOns || []).map((a) => ({ text: a.name, amount: a.price * (booking.qty || 1) })), ...(p.discount ? [{ text: `Subscription discount (${p.discountPct}%)`, amount: -p.discount }] : [])],
    taxable: 0, gst: 0, total: p.careValue, note: 'Health care services by a clinical establishment / registered professional are exempt from GST.',
  }, 'inv');
  db.insert('invoices', {
    bookingId: booking.id, seniorId: booking.seniorId, number: `ELK/${new Date(db.now()).getUTCFullYear()}/${String(n + 1).padStart(5, '0')}`,
    issuer: 'ElderLink Care Technologies Pvt Ltd (demo)', issuerGstin: '29AAAAA0000A1Z5', kind: 'platform',
    lines: [{ text: 'Platform fee', amount: p.platformFee }], taxable: p.platformFee, gst: p.gst, total: p.platformFee + p.gst, note: 'GST at 18% on platform fee.',
  }, 'inv');
}
