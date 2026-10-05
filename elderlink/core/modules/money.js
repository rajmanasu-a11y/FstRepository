// FR-PAY (payments, payouts, refunds, invoices, credits, reconciliation).
import { assert } from '../util.js';
import { caregiverFor, isStaff, providerAdminFor, requireRole, requireSenior } from '../context.js';
import { creditBalance } from '../payments.js';
import { runPayouts } from '../jobs.js';

export function routes(r) {
  r('GET', '/me/wallet', ({ db, user }) => {
    const payments = db.filter('payments', (p) => p.userId === user.id).sort((a, b) => b.createdAt - a.createdAt);
    const refunds = db.filter('refunds', (x) => x.userId === user.id).sort((a, b) => b.createdAt - a.createdAt);
    const credits = db.filter('credits', (c) => c.userId === user.id).sort((a, b) => b.createdAt - a.createdAt);
    const seniorIds = [...new Set(payments.map((p) => p.seniorId))];
    const monthStart = db.now() - 30 * 86400000;
    const spendBySenior = seniorIds.map((id) => ({ seniorId: id, name: db.get('seniors', id)?.name, amount: payments.filter((p) => p.seniorId === id && p.createdAt >= monthStart).reduce((s, p) => s + p.amount - (p.refunded || 0), 0) }));
    return { balance: creditBalance(db, user.id), payments, refunds, credits, spendBySenior };
  });

  r('GET', '/invoices/:id', ({ db, user, params }) => {
    const inv = db.get('invoices', params.id);
    assert(inv, 404, 'Invoice not found');
    if (!isStaff(user)) {
      try { requireSenior(db, user, inv.seniorId); } catch {
        const p = providerAdminFor(db, user) || db.get('providers', caregiverFor(db, user)?.providerId);
        const b = db.get('bookings', inv.bookingId);
        assert(p && b && b.providerId === p.id, 403, 'Not your invoice');
      }
    }
    return inv;
  });

  r('GET', '/seniors/:id/invoices', ({ db, user, params }) => {
    requireSenior(db, user, params.id);
    return db.filter('invoices', (i) => i.seniorId === params.id).sort((a, b) => b.createdAt - a.createdAt);
  });

  // FR-PAY-04 provider payout ledger
  r('GET', '/my/payouts', ({ db, user }) => {
    const p = providerAdminFor(db, user) || db.get('providers', caregiverFor(db, user)?.providerId);
    assert(p, 403, 'No provider account');
    const rows = db.filter('payouts', (x) => x.providerId === p.id).sort((a, b) => b.createdAt - a.createdAt).map((x) => ({ ...x, booking: db.get('bookings', x.bookingId) && { serviceName: db.get('bookings', x.bookingId).serviceName, seniorName: db.get('bookings', x.bookingId).seniorName, start: db.get('bookings', x.bookingId).start } }));
    const inEscrow = db.filter('bookings', (b) => b.providerId === p.id && ['requested', 'accepted', 'assigned', 'in_progress', 'completed', 'disputed'].includes(b.status)).reduce((s, b) => s + (b.price?.providerShare || 0), 0);
    return {
      rows, inEscrow,
      paid: rows.filter((x) => x.status === 'paid').reduce((s, x) => s + x.amount, 0),
      scheduled: rows.filter((x) => x.status === 'scheduled').reduce((s, x) => s + x.amount, 0),
      held: rows.filter((x) => x.status === 'held').reduce((s, x) => s + x.amount, 0),
      bank: p.bank || null,
    };
  });

  r('POST', '/ops/payouts/run', ({ db, user }) => {
    requireRole(user, 'admin', 'coordinator');
    return { paid: runPayouts(db) };
  });

  // FR-PAY-11 daily reconciliation
  r('GET', '/ops/reconciliation', ({ db, user }) => {
    requireRole(user, 'admin', 'coordinator');
    const payments = db.all('payments');
    const captured = payments.reduce((s, p) => s + p.amount, 0);
    const refunded = db.all('refunds').reduce((s, x) => s + x.amount, 0);
    const inEscrow = payments.filter((p) => p.status === 'escrow').reduce((s, p) => s + p.amount, 0);
    const payouts = db.all('payouts');
    const paidOut = payouts.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
    const mismatches = [];
    for (const b of db.all('bookings')) {
      if (b.paymentId && ['confirmed', 'paid_out'].includes(b.status) && !db.find('payouts', (p) => p.bookingId === b.id)) mismatches.push({ bookingId: b.id, issue: 'Confirmed but no payout scheduled' });
      if (b.status === 'cancelled' && b.paymentId && !db.find('refunds', (x) => x.bookingId === b.id) && (db.get('payments', b.paymentId)?.amount || 0) > (b.cancelCharge || 0)) mismatches.push({ bookingId: b.id, issue: 'Cancelled without refund' });
    }
    return { captured, refunded, inEscrow, paidOut, payoutsScheduled: payouts.filter((p) => p.status === 'scheduled').length, mismatches: mismatches.slice(0, 20) };
  });
}
