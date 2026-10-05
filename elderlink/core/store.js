// A tiny document store. The same code backs the Node server (JSON file on disk)
// and the in-browser demo (localStorage), so business rules run identically in both.

export const COLLECTIONS = [
  'users', 'sessions', 'otps', 'consents', 'seniors', 'circle', 'providers', 'caregivers',
  'services', 'listings', 'priceHistory', 'bookings', 'visitReports', 'reviews', 'qualityTickets',
  'plans', 'subscriptions', 'medicines', 'doses', 'vitals', 'cases', 'payments', 'payouts', 'refunds',
  'invoices', 'credits', 'notifications', 'grievances', 'approvalRules', 'tasks', 'activity',
  'carePlans', 'scamAlerts', 'scamReports', 'checkins', 'equipment', 'equipmentOrders', 'events',
  'rsvps', 'entitlementApps', 'vault', 'supplyRequests', 'audit', 'favourites', 'verificationLog',
  'helplineCalls', 'courses', 'courseProgress', 'householdFlags',
];

export function emptyData() {
  const data = { meta: { seq: 1000, clockOffset: 0, seededAt: null, version: 1 } };
  for (const c of COLLECTIONS) data[c] = [];
  return data;
}

export class Store {
  constructor(data) {
    this.data = data || emptyData();
    for (const c of COLLECTIONS) if (!this.data[c]) this.data[c] = [];
    this.dirty = false;
  }
  now() { return Date.now() + (this.data.meta.clockOffset || 0); }
  id(prefix) { this.data.meta.seq += 1; return `${prefix}_${this.data.meta.seq.toString(36)}`; }
  all(col) { return this.data[col]; }
  get(col, id) { return this.data[col].find((r) => r.id === id) || null; }
  find(col, pred) { return this.data[col].find(pred) || null; }
  filter(col, pred) { return this.data[col].filter(pred); }
  insert(col, row, prefix) {
    const rec = { id: row.id || this.id(prefix || col.slice(0, 3)), createdAt: row.createdAt || this.now(), ...row };
    this.data[col].push(rec);
    this.dirty = true;
    return rec;
  }
  update(col, id, patch) {
    const rec = this.get(col, id);
    if (!rec) return null;
    Object.assign(rec, patch, { updatedAt: this.now() });
    this.dirty = true;
    return rec;
  }
  remove(col, id) {
    const i = this.data[col].findIndex((r) => r.id === id);
    if (i >= 0) { this.data[col].splice(i, 1); this.dirty = true; }
  }
  toJSON() { return this.data; }
}
