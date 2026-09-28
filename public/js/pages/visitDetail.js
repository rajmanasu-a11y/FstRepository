import { html, render, $, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { can, canAny, session } from '../lib/state.js';
import { navigate, openPrint } from '../lib/router.js';
import { fmtDate, fmtTime, fmtDateTime, fmtDuration, fmtDurationWords, fmtLongDate, statusBadge, maskMobile, todayIso } from '../lib/format.js';
import { emptyState, loadingBlock, toast, toastError, promptDialog, confirmDialog, alertBox } from '../lib/ui.js';
import { watchlistAlert } from '../components/visitCard.js';

const EVENT_LABELS = {
  PRE_REGISTERED: 'Expected / pre-registered', REGISTERED: 'Visitor registered', APPROVAL_REQUESTED: 'Host approval requested', APPROVED: 'Approved / ready for check-in',
  REJECTED: 'Rejected by host', PENDING_APPROVAL: 'Awaiting host approval', EXPECTED: 'Expected', ID_VERIFIED: 'Identity verified',
  DECLARATION_ACCEPTED: 'Visitor declaration accepted', CHECKED_IN: 'Checked in – visitor pass issued', HOST_NOTIFIED: 'Host notified',
  PASS_PRINTED: 'Visitor pass printed', OVERSTAY: 'Overstay flagged', CHECKED_OUT: 'Checked out', VISIT_CLOSED: 'Visit record closed',
  CANCELLED: 'Visit cancelled', DENIED_RESTRICTED: 'Entry denied – restricted visitor',
};
const DOT = { CHECKED_IN: 'ok', CHECKED_OUT: 'ok', VISIT_CLOSED: 'ok', APPROVED: 'ok', OVERSTAY: 'warn', APPROVAL_REQUESTED: 'warn', REJECTED: 'bad', DENIED_RESTRICTED: 'bad', CANCELLED: 'bad' };

export default async function visitDetail(root, { params }) {
  let v = null;
  async function load() {
    render(root, loadingBlock('Loading visit details…'));
    let data;
    try { data = await api(`/visits/${params.id}`); } catch (err) { render(root, emptyState('Visit record not found', err.message, 'alert')); return; }
    const { timeline, approvals, notifications } = data;
    v = data.visit;
    const ownHost = session.user.employeeId && v.host.id === session.user.employeeId;
    const actions = [];
    if (can('visit.checkin') && ['EXPECTED', 'APPROVED'].includes(v.status)) actions.push(html`<a class="btn success" href="/check-in?q=${v.visitCode}">${icon('logIn')}Check In</a>`);
    if (can('visit.checkout') && ['CHECKED_IN', 'OVERSTAY'].includes(v.status)) actions.push(html`<a class="btn danger" href="/check-out?q=${v.pass?.passNumber || v.visitCode}">${icon('logOut')}Check Out</a>`);
    if (v.status === 'PENDING_APPROVAL' && (can('visit.approve_any') || (can('visit.approve_own') && ownHost))) {
      actions.push(html`<button type="button" class="btn success" data-approve>${icon('check')}Approve</button><button type="button" class="btn danger-outline" data-reject>${icon('x')}Reject</button>`);
    }
    if (can('pass.print') && v.pass) actions.push(html`<button type="button" class="btn" data-print-pass>${icon('printer')}Print Pass</button><button type="button" class="btn" data-print-record>${icon('report')}Half-A4 Record</button>`);
    if (v.isPreregistered && ['EXPECTED', 'PENDING_APPROVAL', 'APPROVED'].includes(v.status) && canAny('prereg.any', 'prereg.own', 'pass.print')) actions.push(html`<button type="button" class="btn" data-print-invite>${icon('qr')}Print Invitation</button>`);
    if (['EXPECTED', 'PENDING_APPROVAL', 'APPROVED'].includes(v.status) && (can('visit.cancel') || (can('prereg.own') && ownHost))) actions.push(html`<button type="button" class="btn ghost" data-cancel-visit>Cancel Visit</button>`);

    const row = (l, val) => html`<dt>${l}</dt><dd>${val || html`<span class="faint">—</span>`}</dd>`;
    render(root, html`
      <nav class="muted mb-1" aria-label="Breadcrumb" style="font-size:.86rem"><a href="/visitors">Visitor Search &amp; History</a> › Visitor Visit Details</nav>
      <div class="page-header">
        <div>
          <div class="muted mono" style="font-size:.86rem">${v.visitCode}${v.pass ? ` · ${v.pass.passNumber}` : ''}</div>
          <h1>${v.visitor.fullName} ${statusBadge(v.status)}</h1>
          <div class="subtitle">${v.companyName || 'Individual'} · to meet ${v.host.name}, ${v.host.designation} · ${fmtLongDate(v.appointmentDate)}</div>
        </div>
        <div class="page-actions">${actions}</div>
      </div>
      ${watchlistAlert(v)}
      ${v.statusReason ? html`<div class="mb-2">${alertBox(v.status === 'DENIED' ? 'danger' : 'info', v.status === 'DENIED' ? 'Entry denied' : v.status === 'CANCELLED' ? 'Cancelled' : 'Note', html`${v.statusReason}`)}</div>` : ''}
      <div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(300px,1fr);align-items:start">
        <div class="stack" style="gap:16px">
          <section class="card"><div class="card-header"><h2>Visitor Information</h2>${can('visitor.view') ? html`<a class="btn sm" href="/visitors/${v.visitor.id}">${icon('user')}Visitor Profile</a>` : ''}</div>
            <div class="card-body" style="display:grid;grid-template-columns:96px minmax(0,1fr);gap:18px">
              ${v.visitor.photoUrl ? html`<img src="${v.visitor.photoUrl}" alt="" style="width:96px;height:128px;object-fit:cover;border-radius:8px;border:1px solid var(--border)">` : html`<div class="thumb-initials" style="width:96px;height:128px;border-radius:8px;font-size:1.5rem">${v.visitor.fullName.slice(0, 1)}</div>`}
              <dl class="kv">
                ${row('Visitor Name', v.visitor.fullName)}${row('Visitor ID', v.visitor.visitorCode)}${row('Organisation / Company', v.companyName)}
                ${row('Designation', v.visitor.designation)}${row('Mobile', v.visitor.mobileNumber ? `${v.visitor.mobileCountryCode} ${can('visitor.update') ? v.visitor.mobileNumber : maskMobile(v.visitor.mobileNumber)}` : '')}
                ${row('Email', v.visitor.email)}${row('Total Visits', String(v.visitor.totalVisits))}
              </dl></div></section>
          <section class="card"><div class="card-header"><h2>Host / Officer to be Met</h2></div>
            <div class="card-body"><dl class="kv">${row('Host', v.host.name)}${row('Designation', v.host.designation)}${row('Department', v.departmentName)}${row('Employee ID', v.host.employeeCode)}${row('Location', v.host.location)}</dl></div></section>
          <section class="card"><div class="card-header"><h2>Visit Details</h2></div>
            <div class="card-body"><dl class="kv">
              ${row('Purpose of Visit', v.purpose)}${row('Visitor Category', v.categoryName)}${row('Appointment Type', v.appointmentType.replace('_', '-').toLowerCase().replace(/^./, (c) => c.toUpperCase()))}
              ${row('Appointment Date', fmtDate(v.appointmentDate))}${row('Expected Arrival', v.expectedArrival ? fmtTime(v.expectedArrival) : '')}${row('Expected Duration', fmtDurationWords(v.expectedDurationMin))}
              ${row('Access Area', v.accessAreaName ? `${v.accessAreaName}${v.accessAreaRestricted ? ' (restricted)' : ''}` : '')}${row('Entry Point', v.entryPoint)}
              ${row('Date & Time of Arrival', v.checkInAt ? fmtDateTime(v.checkInAt) : '')}${row('Valid Until', v.validUntil ? fmtTime(v.validUntil) : '')}
              ${row('Date & Time of Departure', v.checkOutAt ? fmtDateTime(v.checkOutAt) : '')}
              ${row('Duration', v.checkInAt ? html`${fmtDuration(v.durationMinutes ?? v.elapsedMinutes)} hrs${!v.checkOutAt ? ' (on premises)' : ''}` : '')}
              ${row('Visitor Pass Number', v.pass?.passNumber)}${row('Special Instructions', v.specialInstructions)}${row('Remarks', v.remarks)}
            </dl></div></section>
          <section class="card"><div class="card-header"><h2>Identity, Declaration &amp; Vehicle</h2></div>
            <div class="card-body"><dl class="kv">
              ${row('ID Document', v.visitor.idTypeName ? `${v.visitor.idTypeName} ${v.visitor.idReference || ''}` : '')}
              ${row('ID Verified', v.idVerified ? `Yes – ${v.idVerifiedByName || ''} ${v.idVerifiedAt ? fmtDateTime(v.idVerifiedAt) : ''}` : 'No')}
              ${row('Verification Remarks', v.verificationRemarks)}
              ${row('Declaration', v.consentGiven ? `Accepted ${fmtDateTime(v.consentAt)} (version ${v.consentTextVersion || '1.0'})` : 'Not accepted')}
              ${row('Vehicle', v.vehicle ? `${v.vehicle.registrationNumber} · ${v.vehicle.vehicleType.replace('_', ' ')}${v.vehicle.parkingRequired ? ' · parking required' : ''}${v.vehicle.driverName ? ` · driver ${v.vehicle.driverName}` : ''}` : '')}
            </dl></div></section>
        </div>
        <div class="stack" style="gap:16px">
          <section class="card"><div class="card-header"><h2>Visit Timeline</h2><span class="hint">Every stage is time-stamped</span></div>
            <div class="card-body"><ol class="timeline">${timeline.map((t) => html`<li><span class="dot ${DOT[t.event] || ''}" aria-hidden="true"></span>
              <div class="t-title">${EVENT_LABELS[t.event] || t.event}</div>
              <div class="t-meta">${fmtDateTime(t.changedAt)} · ${t.changedByName}</div>
              ${t.remarks ? html`<div class="t-meta">${t.remarks}</div>` : ''}</li>`)}</ol></div></section>
          ${approvals.length ? html`<section class="card"><div class="card-header"><h2>Approvals</h2></div><div class="card-body stack">${approvals.map((a) => html`
            <div><span class="tag ${a.decision === 'APPROVED' ? 'success' : a.decision === 'REJECTED' ? 'danger' : 'warning'}">${a.decision}</span>
            <div class="cell-sub mt-1">Requested ${fmtDateTime(a.requested_at)} · ${a.reason || ''}</div>
            ${a.decided_at ? html`<div class="cell-sub">Decided ${fmtDateTime(a.decided_at)} by ${a.decided_by_name || '—'}${a.remarks ? ` – ${a.remarks}` : ''}</div>` : ''}</div>`)}</div></section>` : ''}
          <section class="card"><div class="card-header"><h2>Host Notifications</h2></div><div class="card-body">
            ${notifications.length ? html`<ul style="margin:0;padding-left:18px">${notifications.map((n) => html`<li class="mb-1"><b>${n.type.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</b> via ${n.channel.replace('_', '-')} – ${n.status.toLowerCase()}${n.status_detail ? html` <span class="cell-sub">(${n.status_detail})</span>` : ''}<div class="cell-sub">${fmtDateTime(n.created_at)}</div></li>`)}</ul>` : html`<span class="muted">No notifications sent for this visit.</span>`}
          </div></section>
        </div>
      </div>`);

  }
  on(root, 'click', '[data-print-pass]', () => openPrint(`/print/pass/${v.id}`));
  on(root, 'click', '[data-print-record]', () => openPrint(`/print/record/${v.id}`));
  on(root, 'click', '[data-print-invite]', () => openPrint(`/print/invitation/${v.id}`));
  on(root, 'click', '[data-approve]', async () => {
    try { const r = await api(`/visits/${v.id}/decision`, { method: 'POST', body: { decision: 'APPROVE' } }); toast(r.message); load(); } catch (err) { toastError(err); }
  });
  on(root, 'click', '[data-reject]', async () => {
    const reason = await promptDialog({ title: 'Reject visit request', label: 'Reason for rejection', confirmLabel: 'Reject Visit', danger: true });
    if (!reason) return;
    try { const r = await api(`/visits/${v.id}/decision`, { method: 'POST', body: { decision: 'REJECT', remarks: reason } }); toast(r.message); load(); } catch (err) { toastError(err); }
  });
  on(root, 'click', '[data-cancel-visit]', async () => {
    const reason = await promptDialog({ title: 'Cancel visit', label: 'Reason for cancellation', confirmLabel: 'Cancel Visit', danger: true });
    if (!reason) return;
    try { const r = await api(`/visits/${v.id}/cancel`, { method: 'POST', body: { reason } }); toast(r.message); load(); } catch (err) { toastError(err); }
  });
  await load();
}
