import { html, render, $, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, apiUrl, download } from '../lib/api.js';
import { session, org, can } from '../lib/state.js';
import {
  fmtDate, fmtTime, fmtDateTime, fmtDuration, fmtLongDate, maskMobile, STATUS_LABELS, fmtNumber,
} from '../lib/format.js';
import { emptyState, loadingBlock, toast, toastError } from '../lib/ui.js';

/**
 * Print previews. Each document is laid out in millimetres at its true paper
 * size, previewed on screen, and printed with CSS @page rules; the toolbar
 * and all application chrome are hidden when printing.
 */
function setPage(css) {
  let tag = document.getElementById('page-style');
  if (!tag) {
    tag = document.createElement('style');
    tag.id = 'page-style';
    document.head.appendChild(tag);
  }
  tag.textContent = css;
}

function shell(root, { title, note, pdf, content, onPrint }) {
  render(root, html`
    <div class="print-toolbar no-print" role="toolbar" aria-label="Print preview actions">
      <span class="title">${icon('printer')} Print Preview – ${title}</span>
      <button type="button" class="btn primary" data-print autofocus>${icon('printer')}Print</button>
      ${pdf ? html`<button type="button" class="btn" data-pdf>${icon('download')}Download PDF</button>` : ''}
      <button type="button" class="btn ghost" style="color:#dbe5f3" data-close-window>Close</button>
    </div>
    <div class="print-canvas">
      ${note ? html`<div class="print-note no-print">${note}</div>` : ''}
      ${content}
    </div>`);
  const printBtn = $('[data-print]', root);
  printBtn.focus();
  on(root, 'click', '[data-print]', async () => {
    try { await onPrint?.(); } catch { /* audit failure must not block printing */ }
    window.print();
  });
  on(root, 'click', '[data-pdf]', async (e, btn) => {
    btn.disabled = true;
    try {
      if (typeof pdf === 'function') await pdf(); else window.open(pdf, '_blank');
    } catch (err) { toastError(err); } finally { btn.disabled = false; }
  });
  on(root, 'click', '[data-close-window]', () => { if (window.opener) window.close(); else history.back(); });
  const onKey = (e) => {
    if (e.key === 'Escape') { if (window.opener) window.close(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); printBtn.click(); }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

const orgLogo = () => (org().logoUrl ? html`<img src="${org().logoUrl}" alt="">` : '');

// ----------------------------------------------------------------------------
// Visitor pass
// ----------------------------------------------------------------------------
function passMarkup(v, tpl) {
  const pass = v.pass;
  return html`
    <div class="doc pass paper" style="--pass-w:${tpl.widthMm || 90}mm;--pass-h:${tpl.heightMm || 60}mm;--pass-color:${tpl.headerColor || '#12305a'}" data-doc="pass">
      <div class="pass-head">${orgLogo()}<div class="pass-org">${org().name}</div><div class="pass-title">VISITOR PASS</div></div>
      <div class="pass-body">
        ${tpl.showPhoto !== false ? html`<div class="pass-photo">${v.visitor.photoUrl ? html`<img src="${v.visitor.photoUrl}" alt="Visitor photograph">` : 'No photograph'}</div>` : html`<div></div>`}
        <div style="min-width:0">
          <div class="pass-name">${v.visitor.fullName}</div>
          <div class="pass-company">${v.companyName || 'Individual'}</div>
          <div class="pass-field"><div class="l">Whom to Meet</div><div class="v">${v.host.name}</div><div class="s">${v.host.designation}</div></div>
          <div class="pass-field"><div class="l">Department</div><div class="v">${v.departmentName}</div></div>
          <div class="pass-field"><div class="l">Purpose</div><div class="v">${v.purpose}</div></div>
        </div>
        ${tpl.showQr !== false ? html`<div class="pass-qr"><img src="/api/visits/${v.id}/qr.svg" alt="QR code for pass verification"><span>SCAN TO VERIFY</span></div>` : ''}
      </div>
      <div class="pass-foot">
        <div><div class="l">Date</div><div class="v">${fmtDate(v.checkInAt || v.appointmentDate)}</div></div>
        <div><div class="l">Check-In</div><div class="v">${fmtTime(v.checkInAt)}</div></div>
        <div><div class="l">Valid Until</div><div class="v">${fmtTime(v.validUntil)}</div></div>
        <div><div class="l">Pass No.</div><div class="v">${pass?.passNumber || '—'}</div></div>
      </div>
      <div class="pass-instr">${tpl.instruction || ''}</div>
    </div>`;
}

async function passDoc(root, id) {
  const { visit: v } = await api(`/visits/${id}`);
  const tpl = session.settings.print?.VISITOR_PASS || {};
  if (!v.pass) {
    render(root, html`<div class="page">${emptyState('Visitor pass not yet issued', 'A visitor pass is issued when the visitor is checked in. Please check the visitor in first.', 'idCard')}</div>`);
    return null;
  }
  const w = tpl.widthMm || 90;
  const h = tpl.heightMm || 60;
  const onA4 = tpl.paper === 'A4';
  setPage(onA4 ? '@page { size: A4 portrait; margin: 0; }' : `@page { size: ${w}mm ${h}mm; margin: 0; }`);
  document.title = `Visitor Pass ${v.pass.passNumber}`;
  return shell(root, {
    title: `Visitor Pass ${v.pass.passNumber}`,
    note: html`Badge size ${w} mm × ${h} mm${onA4 ? ' on A4 paper (cut along the dotted line)' : ' – select the badge printer and “Actual size / 100%” scaling'}.`,
    pdf: apiUrl(`/print/visits/${v.id}/pass.pdf`),
    content: onA4 ? html`<div class="a4-sheet-pass paper">${passMarkup(v, tpl)}</div>` : passMarkup(v, tpl),
    onPrint: () => api(`/visits/${v.id}/print`, { method: 'POST', body: { kind: 'PASS' } }),
  });
}

// ----------------------------------------------------------------------------
// Half-A4 visitor record (two copies on one A4 sheet)
// ----------------------------------------------------------------------------
function recordMarkup(v, copyLabel, tpl, { invitation = false } = {}) {
  const maskPrint = session.settings.security?.maskMobileInPrint !== false;
  const row = (l, val, mono = false) => html`<div class="rec-row"><span class="l">${l}</span><span class="v ${mono ? 'mono' : ''}" title="${val || ''}">${val || '—'}</span></div>`;
  return html`
    <section class="record" data-doc="record">
      <div class="rec-head">
        ${orgLogo()}
        <div class="rec-org"><div class="n">${org().name}</div><div class="s">Visitor Management System</div>${org().address ? html`<div class="a">${org().address}</div>` : ''}</div>
        <div class="rec-title"><div class="t">${invitation ? 'VISIT INVITATION' : (tpl.title || 'VISITOR RECORD')}</div><span class="c">${copyLabel}</span></div>
      </div>
      <div class="rec-body">
        <div style="min-width:0">
          <div class="rec-section">Visitor Information</div>
          ${row('Visitor Name', v.visitor.fullName)}
          ${row('Organisation / Company', v.companyName || 'Individual')}
          ${row('Designation', v.visitor.designation)}
          ${row('Mobile', v.visitor.mobileNumber ? `${v.visitor.mobileCountryCode} ${maskPrint ? maskMobile(v.visitor.mobileNumber) : v.visitor.mobileNumber}` : '')}
          <div class="rec-section">Host / Officer to be Met</div>
          ${row('Whom to Meet', v.host.name)}
          ${row('Designation', v.host.designation)}
          ${row('Department', v.departmentName)}
          <div class="rec-section">Visit Details</div>
          ${row('Purpose of Visit', v.purpose)}
          ${row('Visit Date', fmtDate(v.checkInAt || v.appointmentDate))}
          ${invitation ? row('Expected Arrival', v.expectedArrival ? fmtTime(v.expectedArrival) : 'Any time') : row('Check-In', v.checkInAt ? fmtTime(v.checkInAt) : 'Not checked in')}
          ${row('Expected Duration', `${fmtDuration(v.expectedDurationMin)} hrs`)}
          ${invitation ? '' : row('Visitor Pass Number', v.pass?.passNumber, true)}
          ${row('Visit Reference Number', v.visitCode, true)}
          ${invitation && v.specialInstructions ? html`<div class="rec-note"><b>Instructions:</b> ${v.specialInstructions}</div>` : ''}
        </div>
        <div class="rec-side">
          ${tpl.showPhoto !== false && !invitation ? html`<div class="rec-photo">${v.visitor.photoUrl ? html`<img src="${v.visitor.photoUrl}" alt="Visitor photograph">` : 'No photograph'}</div>` : ''}
          ${tpl.showQr !== false || invitation ? html`<div class="rec-qr"><img src="/api/visits/${v.id}/qr.svg" alt="QR code" style="${invitation ? 'width:34mm;height:34mm' : ''}"><span>${v.visitCode}</span></div>` : ''}
        </div>
      </div>
      ${invitation
        ? html`<div class="rec-note">Please present this invitation (or the QR code on your phone) at ${org().receptionPoint || 'reception'} together with a valid photo identity document.</div>`
        : tpl.showSignatures !== false ? html`<div class="rec-sign"><div>Visitor Signature</div><div>Reception / Front Desk Officer</div></div>` : ''}
      <div class="rec-foot">${org().footerText || 'This document is generated electronically by the Visitor Management System.'}</div>
    </section>`;
}

async function recordDoc(root, id, { invitation = false } = {}) {
  const { visit: v } = await api(`/visits/${id}`);
  const tpl = session.settings.print?.HALF_A4_RECORD || {};
  const copies = invitation ? ['Visitor Copy', 'Host Copy'] : (tpl.copies?.length === 2 ? tpl.copies : ['Office Copy', 'Visitor Copy']);
  setPage('@page { size: A4 portrait; margin: 0; }');
  document.title = `${invitation ? 'Visit Invitation' : 'Visitor Record'} ${v.visitCode}`;
  return shell(root, {
    title: `${invitation ? 'Visit Invitation' : 'Visitor Record (Half-A4)'} ${v.visitCode}`,
    note: 'A4 portrait · two identical half-page records per sheet · cut along the dotted line. Use “Actual size / 100%” scaling and no headers or footers.',
    pdf: invitation ? null : apiUrl(`/print/visits/${v.id}/record.pdf`),
    content: html`<div class="doc sheet paper" data-sheet>
      ${recordMarkup(v, copies[0], tpl, { invitation })}
      <div class="cut-line" aria-hidden="true"><span>✂ cut along this line</span></div>
      ${recordMarkup(v, copies[1], tpl, { invitation })}
    </div>`,
    onPrint: invitation ? null : () => api(`/visits/${v.id}/print`, { method: 'POST', body: { kind: 'RECORD' } }),
  });
}

// ----------------------------------------------------------------------------
// Reports (landscape A4)
// ----------------------------------------------------------------------------
function cellText(col, row) {
  const v = row[col.key];
  if (v === null || v === undefined || v === '') return '';
  switch (col.type) {
    case 'date': return fmtDate(v);
    case 'time': return fmtTime(v);
    case 'datetime': return fmtDateTime(v);
    case 'duration': return fmtDuration(v);
    case 'status': return STATUS_LABELS[v] || v;
    case 'number': return fmtNumber(v);
    default: return String(v);
  }
}

function docHeader(title, metaItems) {
  return html`
    <div class="rd-head">
      <div><div class="n">${org().name}</div><div class="a">Visitor Management System${org().address ? ` · ${org().address}` : ''}</div></div>
      <div class="t">${title}</div>
    </div>
    <div class="rd-meta">${metaItems.filter(Boolean).map((m) => html`<span>${m}</span>`)}<span>Generated: ${fmtDateTime(new Date())} by ${session.user.fullName}</span></div>`;
}

async function reportDoc(root, type, query) {
  const params = Object.fromEntries(query.entries());
  params.pageSize = 500;
  params.page = 1;
  const data = await api(`/reports/${type}`, { query: params });
  const visibleKeys = params.columns ? params.columns.split(',') : null;
  const cols = data.columns.filter((c) => (visibleKeys ? visibleKeys.includes(c.key) : c.visible !== false));
  setPage('@page { size: A4 landscape; margin: 10mm 10mm 12mm; @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 7pt; color: #637083; } @bottom-left { content: "Visitor Management System"; font-size: 7pt; color: #637083; } }');
  const f = data.filters || {};
  document.title = data.title;
  return shell(root, {
    title: data.title,
    note: data.total > data.rows.length ? `Showing the first ${data.rows.length} of ${data.total} records. Use Export PDF / Excel for the complete report.` : 'A4 landscape.',
    pdf: can('report.export') ? () => download(`/reports/${type}/export`, { ...params, format: 'pdf' }) : null,
    content: html`<div class="doc report-doc paper">
      ${docHeader(data.title, [f.from || f.to ? `Period: ${fmtDate(f.from)} to ${fmtDate(f.to)}` : 'Period: all dates', `Records: ${fmtNumber(data.total)}`])}
      ${data.rows.length ? html`<table class="rd">
        <thead><tr>${cols.map((c) => html`<th class="${c.type === 'number' ? 'num' : ''}">${c.label}</th>`)}</tr></thead>
        <tbody>${data.rows.map((r) => html`<tr>${cols.map((c) => html`<td class="${c.type === 'number' ? 'num' : ''}">${cellText(c, r)}</td>`)}</tr>`)}</tbody>
        ${data.totals ? html`<tfoot><tr>${cols.map((c, i) => html`<td class="${c.type === 'number' ? 'num' : ''}">${i === 0 ? 'Total' : data.totals[c.key] !== undefined ? cellText(c, data.totals) : ''}</td>`)}</tr></tfoot>` : ''}
      </table>` : html`<p>No records found for the selected criteria.</p>`}
      <div class="rd-foot"><span>${org().footerText || ''}</span><span>${data.title}</span></div>
    </div>`,
  });
}

// ----------------------------------------------------------------------------
// Emergency roll call (portrait, large type)
// ----------------------------------------------------------------------------
async function emergencyDoc(root) {
  const data = await api('/reports/emergency');
  setPage('@page { size: A4 portrait; margin: 10mm 10mm 12mm; @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 8pt; } }');
  const showContact = session.settings.security?.showContactOnEmergencyList !== false;
  let n = 0;
  document.title = 'Emergency Roll Call';
  return shell(root, {
    title: 'Emergency Roll Call',
    note: 'A4 portrait. Tick each person as they are accounted for at the assembly point.',
    pdf: () => download('/reports/emergency/export'),
    content: html`<div class="doc report-doc portrait emergency-doc paper">
      <div class="banner"><span>EMERGENCY VISITOR ACCOUNTABILITY – ROLL CALL</span><span>${fmtNumber(data.total)} ON PREMISES</span></div>
      ${docHeader('Roll Call', [`As at ${fmtDateTime(data.generatedAt)}`, `Total persons: ${data.total}`])}
      ${data.groups.filter((g) => g.items.length).map((g) => html`
        <div class="rd-group">${g.title}<span class="cnt">${g.items.length}</span></div>
        <table class="rd"><thead><tr><th style="width:8mm">#</th><th>Name</th><th>Organisation</th><th>Host / Officer</th><th>Location / Area</th><th>Check-In</th>${showContact ? html`<th>Contact</th>` : ''}<th style="width:16mm">Accounted</th></tr></thead>
        <tbody>${g.items.map((r) => html`<tr><td>${++n}</td><td><b>${r.visitor}</b><br><span style="font-size:7.5pt;color:#637083">${r.passNumber || ''}</span></td><td>${r.company || '—'}</td><td>${r.host}</td><td>${r.accessArea || '—'}</td><td>${fmtTime(r.checkIn)}</td>${showContact ? html`<td>${r.mobile || '—'}</td>` : ''}<td style="text-align:center"><span class="rd-box"></span></td></tr>`)}</tbody></table>`)}
      ${!data.total ? html`<p style="font-size:12pt">No visitors are currently recorded as on premises.</p>` : ''}
      <div class="rd-foot"><span>Roll call conducted by: ______________________ &nbsp; Time completed: __________</span><span>${org().name}</span></div>
    </div>`,
    onPrint: null,
  });
}

// ----------------------------------------------------------------------------
// Visitor history
// ----------------------------------------------------------------------------
async function visitorDoc(root, id) {
  const [{ visitor: v, stats }, history] = await Promise.all([api(`/visitors/${id}`), api(`/visitors/${id}/visits`, { query: { pageSize: 500 } })]);
  setPage('@page { size: A4 portrait; margin: 12mm; @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 7pt; } }');
  document.title = `Visitor History – ${v.fullName}`;
  return shell(root, {
    title: `Visitor History – ${v.fullName}`,
    content: html`<div class="doc report-doc portrait paper">
      ${docHeader('Visitor History', [`Visitor ID: ${v.visitorCode}`])}
      <div style="display:flex;gap:5mm;margin-bottom:4mm">
        ${v.photoUrl ? html`<img src="${v.photoUrl}" alt="" style="width:24mm;height:32mm;object-fit:cover;border:.3mm solid #cbd5e1;border-radius:1mm">` : ''}
        <div style="font-size:9pt;line-height:1.6">
          <div style="font-size:14pt;font-weight:800">${v.fullName.toUpperCase()}</div>
          <div>${v.companyName || 'Individual'}${v.designation ? ` · ${v.designation}` : ''}</div>
          <div>Mobile: ${v.mobileCountryCode} ${maskMobile(v.mobileNumber)}</div>
          <div>Total Visits: <b>${stats.totalVisits}</b> · First Visit: <b>${fmtDate(v.firstVisitAt) || '—'}</b> · Last Visit: <b>${fmtDate(v.lastVisitAt) || '—'}</b></div>
        </div>
      </div>
      <table class="rd"><thead><tr><th>Date</th><th>Visit No.</th><th>Host</th><th>Purpose</th><th>Check-In</th><th>Check-Out</th><th class="num">Duration</th><th>Status</th></tr></thead>
      <tbody>${history.items.map((h) => html`<tr><td>${fmtDate(h.appointmentDate)}</td><td>${h.visitCode}</td><td>${h.host.name}</td><td>${h.purpose}</td><td>${fmtTime(h.checkInAt)}</td><td>${fmtTime(h.checkOutAt)}</td><td class="num">${fmtDuration(h.durationMinutes)}</td><td>${STATUS_LABELS[h.status]}</td></tr>`)}</tbody></table>
      <div class="rd-foot"><span>${org().footerText || ''}</span></div>
    </div>`,
  });
}

export default async function printPage(root, { params, query, kind }) {
  render(root, loadingBlock('Preparing document…'));
  try {
    switch (kind) {
      case 'pass': return await passDoc(root, params.id);
      case 'record': return await recordDoc(root, params.id);
      case 'invitation': return await recordDoc(root, params.id, { invitation: true });
      case 'report': return await reportDoc(root, params.type, query);
      case 'emergency': return await emergencyDoc(root);
      case 'visitor': return await visitorDoc(root, params.id);
      default: render(root, emptyState('Unknown document'));
    }
  } catch (err) {
    render(root, html`<div class="page">${emptyState('Unable to prepare the document', err.message, 'alert')}</div>`);
    toast(err.message, 'error');
  }
  return null;
}
