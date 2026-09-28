import { html, initials } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { fmtDate, fmtTime, fmtLongDate, fmtDurationWords, statusBadge, todayIso } from '../lib/format.js';

export const photoOrInitials = (v, cls = 'thumb') => (v.visitor.photoUrl
  ? html`<img class="${cls}" src="${v.visitor.photoUrl}" alt="" loading="lazy">`
  : html`<span class="thumb-initials ${cls === 'thumb' ? '' : cls}" aria-hidden="true">${initials(v.visitor.fullName)}</span>`);

export function watchlistAlert(v) {
  if (v.visitor.watchlistStatus === 'BLOCKED') {
    return html`<div class="alert danger mb-1" role="alert">${icon('shieldAlert')}<div class="alert-body"><div class="alert-title">RESTRICTED VISITOR – entry not permitted</div>${v.visitor.watchlistReason || ''}</div></div>`;
  }
  if (v.visitor.watchlistStatus === 'FLAGGED') {
    return html`<div class="alert warning mb-1" role="alert">${icon('alert')}<div class="alert-body"><div class="alert-title">Flagged visitor</div>${v.visitor.watchlistReason || ''}</div></div>`;
  }
  return '';
}

/** Lookup list row used on the check-in / check-out desks. */
export function lookupItem(v, { mode, current }) {
  const when = mode === 'checkout'
    ? html`<div class="right"><div class="strong">${fmtTime(v.checkInAt)}</div><div class="cell-sub">${fmtDurationWords(v.elapsedMinutes)}</div></div>`
    : html`<div class="right"><div class="strong">${v.appointmentDate === todayIso() ? (v.expectedArrival ? fmtTime(v.expectedArrival) : 'Today') : fmtDate(v.appointmentDate)}</div><div>${statusBadge(v.status)}</div></div>`;
  return html`<button type="button" class="lookup-item" data-visit="${v.id}" aria-current="${current ? 'true' : 'false'}">
    ${photoOrInitials(v)}
    <div style="min-width:0">
      <div class="cell-main">${v.visitor.fullName}${v.visitor.watchlistStatus !== 'NONE' ? html` <span class="tag danger">${v.visitor.watchlistStatus === 'BLOCKED' ? 'Restricted' : 'Flagged'}</span>` : ''}${v.status === 'OVERSTAY' ? html` ${statusBadge('OVERSTAY')}` : ''}</div>
      <div class="cell-sub">${v.companyName || 'Individual'} · to meet ${v.host.name}</div>
      <div class="cell-sub mono">${v.pass?.passNumber || v.visitCode}</div>
    </div>
    ${when}
  </button>`;
}

/** Visitor photo | Name | Company | Host | Purpose summary card. */
export function visitSummary(v) {
  return html`
    <div class="vc-head">
      ${v.visitor.photoUrl ? html`<img class="vc-photo" src="${v.visitor.photoUrl}" alt="Photograph of ${v.visitor.fullName}">` : html`<div class="vc-photo thumb-initials" style="font-size:1.8rem;border-radius:8px">${initials(v.visitor.fullName)}</div>`}
      <div style="min-width:0">
        <div class="vc-name">${v.visitor.fullName}</div>
        <div class="vc-company">${v.companyName || 'Individual'}${v.visitor.designation ? ` · ${v.visitor.designation}` : ''}</div>
        <dl class="kv compact">
          <dt>Host / Officer</dt><dd>${v.host.name}<div class="cell-sub" style="font-weight:500">${v.host.designation} · ${v.departmentName}</div></dd>
          <dt>Purpose of Visit</dt><dd>${v.purpose}</dd>
          <dt>Visit Reference</dt><dd class="mono">${v.visitCode}</dd>
          <dt>Status</dt><dd>${statusBadge(v.status)}</dd>
        </dl>
      </div>
    </div>`;
}

export function appointmentNote(v) {
  if (v.appointmentDate === todayIso()) return v.expectedArrival ? `Expected at ${fmtTime(v.expectedArrival)} today` : 'Expected today';
  return v.appointmentDate > todayIso() ? `Appointment is on ${fmtLongDate(v.appointmentDate)} (early arrival)` : `Appointment was on ${fmtLongDate(v.appointmentDate)}`;
}
